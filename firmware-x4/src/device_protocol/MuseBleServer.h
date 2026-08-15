#pragma once
// Margin/Muse — BLE GATT server that pushes page text to the companion app.
// Service UUID:        4D555345-0001-1000-8000-000000000000  ("MUSE")
// Page-text char UUID: 4D555345-0002-1000-8000-000000000000
//
// Protocol: each notify carries [seq:u8][total:u8][utf8 payload…]
// seq 0..(total-1) form a complete page; receiver reassembles then speaks.
#include <cstddef>

class MuseBleServer {
public:
    // Idempotent — safe to call from EpubReaderActivity::onEnter() every time.
    static void init();

    // Send page text as chunked BLE notifications. No-op if no client is
    // subscribed. text must remain valid for the duration of the call.
    static void notifyPageText(const char* text, size_t len);

    static bool isConnected();
};
