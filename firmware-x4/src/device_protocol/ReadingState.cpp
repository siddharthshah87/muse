// Margin/Muse device protocol — reading position state.
#include "ReadingState.h"

#include <Arduino.h>
#include <cstring>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>

namespace ReadingState {

// Spinlock: compile-time initialized, no heap, safe before the scheduler starts.
// copyable under the lock because Snapshot contains only POD char[] + primitives.
static portMUX_TYPE _mux     = portMUX_INITIALIZER_UNLOCKED;
static Snapshot     _state   = {};

void update(const char* bookPath, const char* title, const char* author,
            uint16_t spineIndex, uint32_t charOffset, float progress) {
  taskENTER_CRITICAL(&_mux);
  _state.active     = true;
  strncpy(_state.bookPath, bookPath ? bookPath : "", sizeof(_state.bookPath) - 1);
  strncpy(_state.title,    title    ? title    : "", sizeof(_state.title)    - 1);
  strncpy(_state.author,   author   ? author   : "", sizeof(_state.author)   - 1);
  _state.spineIndex = spineIndex;
  _state.charOffset = charOffset;
  _state.progress   = progress;
  _state.updatedMs  = static_cast<uint32_t>(millis());
  taskEXIT_CRITICAL(&_mux);
}

Snapshot get() {
  taskENTER_CRITICAL(&_mux);
  const Snapshot snap = _state;
  taskEXIT_CRITICAL(&_mux);
  return snap;
}

}  // namespace ReadingState
