#pragma once
/**
 * muse_trace_backend.h — Lightweight text ring-buffer tracer for ESP32.
 *
 * Stores the last MUSE_TRACE_RING_SIZE log entries in SRAM.
 * Each entry: "[+ms] TAG  message\n"
 *
 * Flush: send 'T\n' on serial → device prints all buffered entries.
 *        Also call muse_trace_flush() from C++ (has Serial access).
 */

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ── Config ───────────────────────────────────────────────────────────────────
#define MUSE_TRACE_RING_SIZE   64u    // number of entries kept in ring
#define MUSE_TRACE_ENTRY_LEN   96u    // max chars per entry (incl. null)

// ── API ───────────────────────────────────────────────────────────────────────

// Initialise (idempotent — safe to call multiple times).
void muse_trace_init(void);

// Record a trace event: tag is a short label, fmt is printf-style.
void muse_trace_log(const char* tag, const char* fmt, ...);

// Dump all buffered entries over stdout (USB-CDC serial).
// Thread-safe. Call from C++ with Serial available.
void muse_trace_flush(void);

#ifdef __cplusplus
}
#endif
