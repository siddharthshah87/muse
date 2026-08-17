/**
 * muse_trace_backend.c — Lightweight text ring-buffer tracer for ESP32.
 *
 * Stores the last MUSE_TRACE_RING_SIZE log entries in SRAM.
 * No binary format, no lifecycle bugs, no assert crashes.
 *
 * Flush protocol (USB-CDC):
 *   Host sends 'T\n'  →  device prints "=== MUSE TRACE DUMP ===" header,
 *   all buffered entries (oldest→newest), then "=== END ===".
 */

#include "muse_trace_backend.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>

// ── Ring ─────────────────────────────────────────────────────────────────────

static char     _ring[MUSE_TRACE_RING_SIZE][MUSE_TRACE_ENTRY_LEN];
static uint32_t _head = 0;   // next write slot (monotonic)
static uint32_t _count = 0;  // entries written so far (capped at RING_SIZE)

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

    char* slot = _ring[_head & (MUSE_TRACE_RING_SIZE - 1)];

    // Write "[+ms] TAG  message" into slot
    int used = snprintf(slot, MUSE_TRACE_ENTRY_LEN, "[+%6lu] %-10s ", (unsigned long)now_ms, tag);
    if (used < 0) used = 0;
    if (used < (int)MUSE_TRACE_ENTRY_LEN - 1) {
        va_list ap;
        va_start(ap, fmt);
        vsnprintf(slot + used, MUSE_TRACE_ENTRY_LEN - (size_t)used, fmt, ap);
        va_end(ap);
    }
    slot[MUSE_TRACE_ENTRY_LEN - 1] = '\0';

    if (xSemaphoreTake(_mutex, 0) == pdTRUE) {
        _head++;
        if (_count < MUSE_TRACE_RING_SIZE) _count++;
        xSemaphoreGive(_mutex);
    }
}

// ── Flush ─────────────────────────────────────────────────────────────────────

void muse_trace_flush(void) {
    if (!_mutex) { puts("[TRACE] not init"); return; }
    xSemaphoreTake(_mutex, portMAX_DELAY);

    uint32_t count = _count < MUSE_TRACE_RING_SIZE ? _count : MUSE_TRACE_RING_SIZE;
    uint32_t oldest = (_head - count) & (MUSE_TRACE_RING_SIZE - 1);

    printf("=== MUSE TRACE DUMP (%lu entries) ===\n", (unsigned long)count);
    for (uint32_t i = 0; i < count; i++) {
        uint32_t idx = (oldest + i) & (MUSE_TRACE_RING_SIZE - 1);
        puts(_ring[idx]);
    }
    puts("=== END ===");

    xSemaphoreGive(_mutex);
}
