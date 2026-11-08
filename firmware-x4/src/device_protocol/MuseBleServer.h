#pragma once
// Margin/Muse — BLE GATT server that pushes page text to the companion app.
// Service UUID:        4D555345-0001-1000-8000-000000000000  ("MUSE")
// Page-text char UUID: 4D555345-0002-1000-8000-000000000000
//
// Protocol: each notify carries [seq:u8][total:u8][utf8 payload…]
// seq 0..(total-1) form a complete page, sent in order; receiver concatenates
// the payload bytes, then decodes UTF-8 (chunks may split a code point).
// See shared/protocol/ble.md.
#include <cstddef>

class MuseBleServer {
public:
    // Idempotent — called from EpubReaderActivity::saveProgress() on every
    // save; the first call starts advertising.
    static void init();

    // Send page text as chunked BLE notifications. No-op if no client is
    // subscribed. text must remain valid for the duration of the call.
    // Text longer than 4096 bytes is cut at the last whole UTF-8 character.
    static void notifyPageText(const char* text, size_t len);

    static bool isConnected();
};
