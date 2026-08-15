#include "MuseBleServer.h"

#include <NimBLEDevice.h>
#include <Logging.h>

#include <algorithm>
#include <cstring>

#define MUSE_SERVICE_UUID   "4D555345-0001-1000-8000-000000000000"
#define PAGE_TEXT_CHAR_UUID "4D555345-0002-1000-8000-000000000000"

static constexpr size_t  CHUNK_PAYLOAD = 180;
static constexpr size_t  MAX_TEXT      = 4096;

static bool                    _initialized     = false;
static bool                    _clientConnected = false;
static NimBLEServer*           _server          = nullptr;
static NimBLECharacteristic*   _pageTextChar    = nullptr;

class MuseCallbacks : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer*) override {
        _clientConnected = true;
        LOG_INF("MBLE", "Companion connected");
    }
    void onDisconnect(NimBLEServer* srv) override {
        _clientConnected = false;
        LOG_INF("MBLE", "Companion disconnected — restarting advertising");
        srv->startAdvertising();
    }
};

void MuseBleServer::init() {
    if (_initialized) return;
    _initialized = true;

    NimBLEDevice::init("Margin");
    _server = NimBLEDevice::createServer();
    _server->setCallbacks(new MuseCallbacks());

    NimBLEService* svc = _server->createService(MUSE_SERVICE_UUID);
    _pageTextChar = svc->createCharacteristic(
        PAGE_TEXT_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY);
    svc->start();

    NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
    adv->addServiceUUID(MUSE_SERVICE_UUID);
    adv->start();

    LOG_INF("MBLE", "Advertising as 'Margin' (service 4D555345-0001-...)");
}

bool MuseBleServer::isConnected() { return _clientConnected; }

void MuseBleServer::notifyPageText(const char* text, size_t len) {
    if (!_clientConnected || !_pageTextChar || len == 0) return;

    len = std::min(len, MAX_TEXT);
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
    LOG_DBG("MBLE", "Sent %u chunk(s) for %u bytes", totalChunks, (unsigned)len);
}
