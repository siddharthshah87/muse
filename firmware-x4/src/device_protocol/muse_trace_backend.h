#pragma once
/**
 * muse_trace_backend.h — Lightweight text ring-buffer tracer for ESP32.
 *
 * Stores the last MUSE_TRACE_RING_SIZE log entries in SRAM.
 * Each entry: "[+ms] TAG  message"
 *
 * Dump: send "CMD:TRACE" on the USB serial port (handled in main.cpp's
 *       serial command loop), or call muse_trace_flush() from C++.
 *       MuseBleServer also dumps automatically every 8 page turns.
 */

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ── Config ───────────────────────────────────────────────────────────────────
#define MUSE_TRACE_RING_SIZE   64u    // number of entries kept in ring (power of 2)
#define MUSE_TRACE_ENTRY_LEN   96u    // max chars per entry (incl. null)

// ── API ───────────────────────────────────────────────────────────────────────

// Receives one formatted entry (no trailing newline) during a flush.
typedef void (*muse_trace_emit_fn)(const char* line);

// Initialise (idempotent — safe to call multiple times).
void muse_trace_init(void);

// Record a trace event: tag is a short label, fmt is printf-style.
// Never blocks for long: if a dump holds the ring, the entry is dropped
// and counted in the next dump's header.
void muse_trace_log(const char* tag, const char* fmt, ...);

// Pass every buffered entry (oldest→newest) to emit, framed by
// "=== MUSE TRACE DUMP ===" / "=== END ===" lines. Thread-safe.
// emit == NULL falls back to puts() (ESP-IDF console, i.e. UART0).
void muse_trace_flush(muse_trace_emit_fn emit);

#ifdef __cplusplus
}
#endif
