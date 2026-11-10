#pragma once
// Margin/Muse — BLE GATT server that pushes page text to the companion app.
// Service UUID:        4D555345-0001-1000-8000-000000000000  ("MUSE")
// Page-text char UUID: 4D555345-0002-1000-8000-000000000000
// Book-info char UUID: 4D555345-0003-1000-8000-000000000000 (JSON: book id, title, chapter)
// Book-notes char UUID: 4D555345-0005-1000-8000-000000000000 (companion's per-book JSON, on SD)
// Control char UUID:   4D555345-0004-1000-8000-000000000000
//                      (write 0x01 = next page, 0x02 = send next page's text without turning,
//                       0x03 = send the current page's text, 0x04 = underline words)
//
// Protocol: each notify carries [seq:u8][total:u8][utf8 payload…]
// seq 0..(total-1) form a complete page, sent in order; receiver concatenates
// the payload bytes, then decodes UTF-8 (chunks may split a code point).
// See shared/protocol/ble.md.
#include <cstddef>
#include <cstdint>

class MuseBleServer {
public:
    // Idempotent — called from EpubReaderActivity::saveProgress() on every
    // save; the first call starts advertising.
    static void init();

    // Send page text as chunked BLE notifications. No-op if no client is
    // subscribed. text must remain valid for the duration of the call.
    // Text longer than 4096 bytes is cut at the last whole UTF-8 character.
    // len == 0 sends one empty chunk so the companion sees text-less pages.
    // preview = true marks a next-page preview (0x80 set on every seq byte).
    static void notifyPageText(const char* text, size_t len, bool preview = false);

    // True once per companion NEXT_PAGE write, if it is under 3 s old.
    static bool takePageTurnRequest();

    // Book/chapter info for the page about to be sent, as compact JSON (see ble.md); READ + NOTIFY
    // on 4D555345-0003. Sent before each page's text.
    static void notifyBookInfo(const char* json, size_t len);

    // Per-book companion notes (e.g. remembered character voices), READ + WRITE on 4D555345-0005,
    // at most 512 bytes. setBookNotes() publishes the open book's notes for reading;
    // takeBookNotes() returns notes the companion wrote (0 if none), for the reader to save.
    static void setBookNotes(const char* data, size_t len);
    static size_t takeBookNotes(char* out, size_t cap);

    // Latest follow-along request (0x04): underline words first..last (0-based, in page-text order)
    // on chapter/page; first == 0xFFFF clears. Returns false if none since the last call.
    static bool takeHighlight(uint16_t& chapter, uint16_t& page, uint16_t& first, uint16_t& last);

    // True once per companion SEND_CURRENT write (0x03), if it is under 3 s old.
    static bool takeCurrentPageRequest();

    // True once per companion PEEK_NEXT write, if it is under 3 s old.
    static bool takePeekRequest();

    // True if the companion wrote any control command in the last windowMs.
    static bool controlledWithin(uint32_t windowMs);

    static bool isConnected();
};
