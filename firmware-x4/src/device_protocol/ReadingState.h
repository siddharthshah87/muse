#pragma once
// Margin/Muse device protocol — reading position state.
//
// Thread-safe snapshot of the current reading position, written by
// EpubReaderActivity::saveProgress() (render task) and read by the HTTP
// handler (main task) to serve GET /api/reading.
//
// Uses a portMUX_TYPE spinlock (compile-time initializable, no heap).
// Strings are fixed char[] so the entire struct is copyable under the spinlock
// without calling malloc (which would deadlock against the heap mutex).
//
// JSON shape: see shared/protocol/locator.md.

#include <cstdint>

namespace ReadingState {

struct Snapshot {
  bool     active           = false;
  char     bookPath[256]    = {};   // SD card path, e.g. "/books/foo.epub"
  char     title[128]       = {};
  char     author[128]      = {};
  uint16_t spineIndex       = 0;    // 0-based spine item index
  uint32_t charOffset       = 0;    // visible codepoint offset within spine item
  float    progress         = 0.0f; // 0.0–1.0 book-level estimate
  uint32_t updatedMs        = 0;    // millis() at last update
};

// Called from the render task on every page turn.
void update(const char* bookPath, const char* title, const char* author,
            uint16_t spineIndex, uint32_t charOffset, float progress);

// Called from the main task (HTTP handler). Returns a copy under the spinlock.
Snapshot get();

}  // namespace ReadingState
