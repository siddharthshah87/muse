#include "MuseBleServer.h"
#include "muse_trace_backend.h"

#include <NimBLEDevice.h>
#include <Logging.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <esp_heap_caps.h>

#include <algorithm>
#include <cstring>

#define MUSE_SERVICE_UUID   "4D555345-0001-1000-8000-000000000000"
#define PAGE_TEXT_CHAR_UUID "4D555345-0002-1000-8000-000000000000"

static constexpr size_t  CHUNK_PAYLOAD = 180;
static constexpr size_t  MAX_TEXT      = 4096;

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

class MuseCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* srv) override {
        _clientConnected = true;
        muse_trace_log("BLE", "connected handle=%d", (int)0);
        LOG_INF("MBLE", "Companion connected");
    }
    void onDisconnect(NimBLEServer* srv, ble_gap_conn_desc* desc) override {
        _clientConnected = false;
        muse_trace_log("BLE", "disconnected handle=%d", (int)desc->conn_handle);
        LOG_INF("MBLE", "Companion disconnected — restarting advertising");
        srv->startAdvertising();
    }
};

static void bleInitTask(void*) {
    muse_trace_log("BLE", "init task start core=%d", (int)xPortGetCoreID());
    LOG_INF("MBLE", "BLE init task starting (core %d)", xPortGetCoreID());

    NimBLEDevice::init("Margin");
    muse_trace_log("BLE", "NimBLE init done heap=%u", esp_get_free_heap_size());

    _server = NimBLEDevice::createServer();
    _server->setCallbacks(new MuseCallbacks());

    NimBLEService* svc = _server->createService(MUSE_SERVICE_UUID);
    muse_trace_log("BLE", "service created");
    _pageTextChar = svc->createCharacteristic(
        PAGE_TEXT_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY);
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

void MuseBleServer::notifyPageText(const char* text, size_t len) {
    // Auto-flush trace ring every 8 page turns
    static uint8_t _flushCounter = 0;
    if (++_flushCounter >= 8) {
        _flushCounter = 0;
        muse_trace_flush(emitTraceLine);
    }

    muse_trace_log("PAGE", "notify init=%d conn=%d len=%u",
                   (int)_initialized, (int)_clientConnected, (unsigned)len);
    LOG_INF("MBLE", "notifyPageText: init=%d connected=%d len=%u",
            (int)_initialized, (int)_clientConnected, (unsigned)len);
    if (!_initialized || !_clientConnected || !_pageTextChar || len == 0) return;

    if (len > MAX_TEXT) len = utf8Boundary(text, MAX_TEXT);
    const uint8_t totalChunks =
        static_cast<uint8_t>((len + CHUNK_PAYLOAD - 1) / CHUNK_PAYLOAD);

    uint8_t buf[2 + CHUNK_PAYLOAD];
    for (uint8_t seq = 0; seq < totalChunks; ++seq) {
        const size_t offset   = seq * CHUNK_PAYLOAD;
        const size_t chunkLen = std::min(CHUNK_PAYLOAD, len - offset);
        buf[0] = seq;
        buf[1] = totalChunks;
        memcpy(buf + 2, text + offset, chunkLen);
        _pageTextChar->setValue(buf, 2 + chunkLen);
        _pageTextChar->notify();
        delay(5);
    }
    muse_trace_log("PAGE", "sent %u chunks", (unsigned)totalChunks);
    LOG_DBG("MBLE", "Sent %u chunk(s) for %u bytes", totalChunks, (unsigned)len);
}
