#include "MuseBleServer.h"
#include "muse_trace_backend.h"

#include <NimBLEDevice.h>
#include <HalPowerManager.h>
#include <Logging.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <esp_heap_caps.h>

#include <Arduino.h>

#include <algorithm>
#include <atomic>
#include <cstring>

#define MUSE_SERVICE_UUID   "4D555345-0001-1000-8000-000000000000"
#define PAGE_TEXT_CHAR_UUID "4D555345-0002-1000-8000-000000000000"
#define CONTROL_CHAR_UUID   "4D555345-0004-1000-8000-000000000000"

static constexpr size_t   CHUNK_PAYLOAD          = 180;
static constexpr size_t   MAX_TEXT               = 4096;
static constexpr uint8_t  CMD_NEXT_PAGE          = 0x01;
static constexpr uint8_t  CMD_PEEK_NEXT          = 0x02;
static constexpr uint8_t  CMD_SEND_CURRENT       = 0x03;
static constexpr uint8_t  PREVIEW_FLAG           = 0x80;  // set on seq for next-page previews
static constexpr uint32_t TURN_REQUEST_TTL_MS    = 3000;

static void emitTraceLine(const char* line) { logSerial.println(line); }

// Largest n <= len that does not split a UTF-8 sequence.
static size_t utf8Boundary(const char* text, size_t len) {
    while (len > 0 && (static_cast<uint8_t>(text[len]) & 0xC0) == 0x80) --len;
    return len;
}

static bool                    _startRequested  = false;
static bool                    _initialized     = false;
static bool                    _clientConnected = false;
static NimBLEServer*           _server          = nullptr;
static NimBLECharacteristic*   _pageTextChar    = nullptr;
// Written from the NimBLE host task, read from the main loop. 0 = none.
static std::atomic<uint32_t>   _turnRequestMs{0};
static std::atomic<uint32_t>   _lastControlMs{0};
static std::atomic<uint32_t>   _peekRequestMs{0};
static std::atomic<uint32_t>   _currentRequestMs{0};

// millis() with 0 reserved for "never".
static uint32_t nowStamp() { const uint32_t t = millis(); return t ? t : 1; }

class ControlCallbacks : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* chr) override {
        const NimBLEAttValue v = chr->getValue();
        if (v.length() < 1) return;
        const uint32_t now = nowStamp();
        _lastControlMs.store(now);
        if (v.data()[0] == CMD_NEXT_PAGE) {
            _turnRequestMs.store(now);
            muse_trace_log("CTRL", "next page requested");
        } else if (v.data()[0] == CMD_SEND_CURRENT) {
            _currentRequestMs.store(now);
            muse_trace_log("CTRL", "current page requested");
        } else if (v.data()[0] == CMD_PEEK_NEXT) {
            _peekRequestMs.store(now);
            muse_trace_log("CTRL", "next page preview requested");
        } else {
            muse_trace_log("CTRL", "unknown command 0x%02x", (unsigned)v.data()[0]);
        }
    }
};

// Raw GAP events into the trace ring: why links drop (HCI reason 0x2xx: 0x213 = peer closed,
// 0x208 = supervision timeout, 0x216 = we closed, 0x23e = failed to establish), plus MTU,
// connection-parameter, encryption and subscription changes. Dump with CMD:TRACE.
static int museGapLogger(ble_gap_event* event, void*) {
    switch (event->type) {
        case BLE_GAP_EVENT_CONNECT:
            muse_trace_log("GAP", "connect status=%d handle=%d", event->connect.status, event->connect.conn_handle);
            break;
        case BLE_GAP_EVENT_DISCONNECT:
            muse_trace_log("GAP", "disconnect reason=0x%x handle=%d", event->disconnect.reason,
                           event->disconnect.conn.conn_handle);
            break;
        case BLE_GAP_EVENT_CONN_UPDATE:
            muse_trace_log("GAP", "conn params updated status=%d", event->conn_update.status);
            break;
        case BLE_GAP_EVENT_CONN_UPDATE_REQ:
            muse_trace_log("GAP", "peer asks conn itvl %d-%d latency %d timeout %d",
                           event->conn_update_req.peer_params->itvl_min, event->conn_update_req.peer_params->itvl_max,
                           event->conn_update_req.peer_params->latency,
                           event->conn_update_req.peer_params->supervision_timeout);
            break;
        case BLE_GAP_EVENT_MTU:
            muse_trace_log("GAP", "mtu=%d", event->mtu.value);
            break;
        case BLE_GAP_EVENT_ENC_CHANGE:
            muse_trace_log("GAP", "encryption change status=%d", event->enc_change.status);
            break;
        case BLE_GAP_EVENT_SUBSCRIBE:
            muse_trace_log("GAP", "subscribe attr=%d notify=%d", event->subscribe.attr_handle,
                           event->subscribe.cur_notify);
            break;
        case BLE_GAP_EVENT_REPEAT_PAIRING:
            muse_trace_log("GAP", "repeat pairing");
            break;
        default:
            break;
    }
    return 0;
}

class MuseCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* srv, ble_gap_conn_desc* desc) override {
        _clientConnected = true;
        // Light sleep would silence the radio long enough for the phone to time the link out
        // (HCI 0x08); stay out of it while a companion is connected (patch 0004).
        powerManager.setRadioHold(true);
        muse_trace_log("BLE", "connected handle=%d", (int)desc->conn_handle);
        LOG_INF("MBLE", "Companion connected");
    }
    void onDisconnect(NimBLEServer* srv, ble_gap_conn_desc* desc) override {
        _clientConnected = false;
        powerManager.setRadioHold(false);
        muse_trace_log("BLE", "disconnected handle=%d", (int)desc->conn_handle);
        LOG_INF("MBLE", "Companion disconnected — restarting advertising");
        srv->startAdvertising();
    }
};

static void bleInitTask(void*) {
    muse_trace_log("BLE", "init task start core=%d", (int)xPortGetCoreID());
    LOG_INF("MBLE", "BLE init task starting (core %d)", xPortGetCoreID());

    NimBLEDevice::init("Margin");
    NimBLEDevice::setCustomGapHandler(museGapLogger);
    muse_trace_log("BLE", "NimBLE init done heap=%u", esp_get_free_heap_size());

    _server = NimBLEDevice::createServer();
    _server->setCallbacks(new MuseCallbacks());

    NimBLEService* svc = _server->createService(MUSE_SERVICE_UUID);
    muse_trace_log("BLE", "service created");
    _pageTextChar = svc->createCharacteristic(
        PAGE_TEXT_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY);
    NimBLECharacteristic* control = svc->createCharacteristic(
        CONTROL_CHAR_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    // Lives for the life of the BLE stack, like the server callbacks above.
    control->setCallbacks(new ControlCallbacks());
    svc->start();

    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->addServiceUUID(MUSE_SERVICE_UUID);
    adv->start();

    _initialized = true;
    muse_trace_log("BLE", "advertising started heap=%u", esp_get_free_heap_size());
    LOG_INF("MBLE", "Advertising as 'Margin' (service 4D555345-0001-...)");
    vTaskDelete(nullptr);
}

void MuseBleServer::init() {
    if (_startRequested) return;
    _startRequested = true;
    muse_trace_init();
    uint32_t freeHeap = esp_get_free_heap_size();
    muse_trace_log("BLE", "init called heap=%u", freeHeap);
    LOG_INF("MBLE", "Spawning BLE init task (free heap: %u)", freeHeap);
    BaseType_t rc = xTaskCreate(bleInitTask, "muse_ble", 8192, nullptr, 1, nullptr);
    muse_trace_log("BLE", "task create rc=%d", (int)rc);
    if (rc != pdPASS) {
        LOG_ERR("MBLE", "xTaskCreate FAILED (rc=%d) — BLE disabled", (int)rc);
        _startRequested = false;
    }
}

bool MuseBleServer::isConnected() { return _clientConnected; }

bool MuseBleServer::takePageTurnRequest() {
    const uint32_t t = _turnRequestMs.exchange(0);
    return t != 0 && millis() - t < TURN_REQUEST_TTL_MS;
}

bool MuseBleServer::takeCurrentPageRequest() {
    const uint32_t t = _currentRequestMs.exchange(0);
    return t != 0 && millis() - t < TURN_REQUEST_TTL_MS;
}

bool MuseBleServer::takePeekRequest() {
    const uint32_t t = _peekRequestMs.exchange(0);
    return t != 0 && millis() - t < TURN_REQUEST_TTL_MS;
}

bool MuseBleServer::controlledWithin(uint32_t windowMs) {
    const uint32_t t = _lastControlMs.load();
    return t != 0 && millis() - t < windowMs;
}

void MuseBleServer::notifyPageText(const char* text, size_t len, bool preview) {
    // Auto-flush trace ring every 8 page turns
    static uint8_t _flushCounter = 0;
    if (++_flushCounter >= 8) {
        _flushCounter = 0;
        muse_trace_flush(emitTraceLine);
    }

    muse_trace_log("PAGE", "notify init=%d conn=%d len=%u preview=%d",
                   (int)_initialized, (int)_clientConnected, (unsigned)len, (int)preview);
    LOG_INF("MBLE", "notifyPageText: init=%d connected=%d len=%u",
            (int)_initialized, (int)_clientConnected, (unsigned)len);
    if (!_initialized || !_clientConnected || !_pageTextChar) return;

    if (len > MAX_TEXT) len = utf8Boundary(text, MAX_TEXT);
    // A page with no text still goes out as one empty chunk (see ble.md).
    const uint8_t totalChunks = len == 0
        ? 1 : static_cast<uint8_t>((len + CHUNK_PAYLOAD - 1) / CHUNK_PAYLOAD);

    uint8_t buf[2 + CHUNK_PAYLOAD];
    for (uint8_t seq = 0; seq < totalChunks; ++seq) {
        const size_t offset   = seq * CHUNK_PAYLOAD;
        const size_t chunkLen = std::min(CHUNK_PAYLOAD, len - offset);
        buf[0] = preview ? static_cast<uint8_t>(seq | PREVIEW_FLAG) : seq;
        buf[1] = totalChunks;
        memcpy(buf + 2, text + offset, chunkLen);
        _pageTextChar->setValue(buf, 2 + chunkLen);
        _pageTextChar->notify();
        delay(5);
    }
    muse_trace_log("PAGE", "sent %u chunks", (unsigned)totalChunks);
    LOG_DBG("MBLE", "Sent %u chunk(s) for %u bytes", totalChunks, (unsigned)len);
}
