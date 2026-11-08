/**
 * muse_trace_backend.c — Lightweight text ring-buffer tracer for ESP32.
 *
 * Stores the last MUSE_TRACE_RING_SIZE log entries in SRAM.
 * No binary format, no lifecycle bugs, no assert crashes.
 *
 * Dump protocol (USB serial):
 *   Host sends "CMD:TRACE\n"  →  device prints "=== MUSE TRACE DUMP ===" header,
 *   all buffered entries (oldest→newest), then "=== END ===".
 */

#include "muse_trace_backend.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>

_Static_assert((MUSE_TRACE_RING_SIZE & (MUSE_TRACE_RING_SIZE - 1)) == 0,
               "MUSE_TRACE_RING_SIZE must be a power of 2");

// ── Ring ─────────────────────────────────────────────────────────────────────

static char     _ring[MUSE_TRACE_RING_SIZE][MUSE_TRACE_ENTRY_LEN];
static uint32_t _head = 0;   // next write slot (monotonic)
static uint32_t _count = 0;  // entries written so far (capped at RING_SIZE)
static volatile uint32_t _dropped = 0;  // entries lost while a dump held the ring

static SemaphoreHandle_t _mutex = NULL;
static uint32_t          _boot_ms = 0;

// ── Init ──────────────────────────────────────────────────────────────────────

void muse_trace_init(void) {
    if (_mutex) return;
    _mutex = xSemaphoreCreateMutex();
    _boot_ms = (uint32_t)((uint64_t)xTaskGetTickCount() * portTICK_PERIOD_MS);
    memset(_ring, 0, sizeof(_ring));
}

// ── Log ───────────────────────────────────────────────────────────────────────

void muse_trace_log(const char* tag, const char* fmt, ...) {
    if (!_mutex) return;

    uint32_t now_ms = (uint32_t)((uint64_t)xTaskGetTickCount() * portTICK_PERIOD_MS)
                      - _boot_ms;

    // Format outside the lock, then publish the finished entry under it so
    // concurrent writers can never share (and corrupt) a slot.
    char entry[MUSE_TRACE_ENTRY_LEN];
    int used = snprintf(entry, sizeof(entry), "[+%6lu] %-10s ", (unsigned long)now_ms, tag);
    if (used < 0) used = 0;
    if (used < (int)sizeof(entry) - 1) {
        va_list ap;
        va_start(ap, fmt);
        vsnprintf(entry + used, sizeof(entry) - (size_t)used, fmt, ap);
        va_end(ap);
    }
    entry[sizeof(entry) - 1] = '\0';

    // Callers include the BLE host task: wait briefly, never for a whole dump.
    if (xSemaphoreTake(_mutex, pdMS_TO_TICKS(5)) != pdTRUE) {
        _dropped++;
        return;
    }
    memcpy(_ring[_head & (MUSE_TRACE_RING_SIZE - 1)], entry, sizeof(entry));
    _head++;
    if (_count < MUSE_TRACE_RING_SIZE) _count++;
    xSemaphoreGive(_mutex);
}

// ── Flush ─────────────────────────────────────────────────────────────────────

static void _emit_puts(const char* line) { puts(line); }

void muse_trace_flush(muse_trace_emit_fn emit) {
    if (!emit) emit = _emit_puts;
    if (!_mutex) { emit("[TRACE] not init"); return; }
    xSemaphoreTake(_mutex, portMAX_DELAY);

    uint32_t count = _count < MUSE_TRACE_RING_SIZE ? _count : MUSE_TRACE_RING_SIZE;
    uint32_t oldest = (_head - count) & (MUSE_TRACE_RING_SIZE - 1);

    char header[64];
    snprintf(header, sizeof(header), "=== MUSE TRACE DUMP (%lu entries, %lu dropped) ===",
             (unsigned long)count, (unsigned long)_dropped);
    emit(header);
    for (uint32_t i = 0; i < count; i++) {
        uint32_t idx = (oldest + i) & (MUSE_TRACE_RING_SIZE - 1);
        emit(_ring[idx]);
    }
    emit("=== END ===");

    xSemaphoreGive(_mutex);
}
