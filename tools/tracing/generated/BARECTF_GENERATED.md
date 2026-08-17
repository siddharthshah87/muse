# barectf Generated Tracer Files

**Generated:** 2026-08-16  
**barectf Version:** 3.1.2  
**Trace UUID:** 8a1fcd82-3b4e-4e1a-9c0a-000000000001  
**Clock:** mono_ms (1000 Hz - FreeRTOS tick counter in milliseconds)  
**Byte Order:** little-endian  

## Files

### barectf.h (213 lines)
- Public API header for tracing functions
- Opaque context structure `struct barectf_ctx`
- Initialization: `barectf_init(ctx, buf, buf_size, cbs, data)`
- Packet management: `barectf_close_packet(ctx)`, `barectf_packet_set_buf(ctx, buf, size)`
- Event tracing functions: 14 total tracer functions

### barectf.c (2,038 lines)
- Complete implementation of tracer functions
- Packet format: CTF (Common Trace Format) with little-endian fields
- Packet structure:
  - Header: magic(0xC1FC1FC1) + UUID(16 bytes) + stream_id(0)
  - Context: timestamp_begin, timestamp_end, content_size, packet_size
  - Events: event_id(u32) + timestamp(u64) + payload fields
- Platform clock implementation: `barectf_get_clock_value()` (weak symbol for esp-idf override)

### barectf-bitfield.h (144 lines)
- Bitfield packing utilities (internal use)
- Used by barectf.c for efficient field packing

### metadata (384 lines)
- CTF 1.8 TSDL metadata describing the trace format
- Defines all 14 event types with field schemas
- Clock frequency and precision definitions
- Compatible with babeltrace2 trace analysis tools

## Generated Events (14 total)

### BLE Events (9)
- `ble.init_called(free_heap: u32)` - id=0
- `ble.task_spawn(success: u8)` - id=1
- `ble.task_start(core_id: u8)` - id=2
- `ble.nimble_init_done()` - id=3
- `ble.service_created()` - id=4
- `ble.adv_start()` - id=5
- `ble.connected(conn_handle: u16)` - id=6
- `ble.disconnected(conn_handle: u16, reason: u8)` - id=7
- `ble.notify_page(text_len: u32, chunks: u8, initialized: u8, connected: u8)` - id=8

### Reader Events (3)
- `reader.save_progress(spine: u16, page: u16, offset: u32)` - id=9
- `reader.text_extracted(length: u32)` - id=10
- `reader.render_done(duration_ms: u32)` - id=11

### System Events (2)
- `sys.heap_mark(free_bytes: u32, min_free_bytes: u32)` - id=12
- `sys.task_create(name: string, stack_bytes: u32, result: u8)` - id=13

## Integration with ESP32 Firmware

### 1. Initialization (in main task or early init)
```c
#include "barectf.h"
#include "freertos/FreeRTOS.h"

static struct barectf_ctx trace_ctx;
static uint8_t trace_buf[65536];  // Adjust size based on available memory

// Callback to handle when packet buffer is full
static int on_packet_open(struct barectf_ctx *ctx, uint8_t *buf, uint32_t size, void *data) {
    // Could DMA to flash/USB here, or queue to log sink
    return 0;
}

static void on_packet_close(struct barectf_ctx *ctx, uint8_t *buf, uint32_t size, void *data) {
    // Packet is complete and ready to send/store
    // esp_trace_send(buf, size);
}

static const barectf_callbacks callbacks = {
    .packet_open = on_packet_open,
    .packet_close = on_packet_close,
};

// Initialize tracer
barectf_init(&trace_ctx, trace_buf, sizeof(trace_buf), &callbacks, NULL);
```

### 2. Provide platform clock
Override in your esp-idf code:
```c
#include "freertos/FreeRTOS.h"

uint64_t barectf_get_clock_value(void) {
    return xTaskGetTickCount();  // FreeRTOS milliseconds
}
```

### 3. Trace events during execution
```c
// Trace BLE initialization
barectf_main_trace_ble_init_called(&trace_ctx, heap_free);

// Trace task spawning
barectf_main_trace_ble_task_spawn(&trace_ctx, success ? 1 : 0);

// Trace heap state
barectf_main_trace_sys_heap_mark(&trace_ctx, free_bytes, min_free_bytes);

// When packet buffer is full, close and switch to new buffer
barectf_close_packet(&trace_ctx);
barectf_packet_set_buf(&trace_ctx, new_buf, sizeof(new_buf));
```

## Trace Analysis

### View trace with babeltrace2
```bash
babeltrace2 --log-level=WARN ./metadata ./trace.bin
```

### Extract specific events
```bash
babeltrace2 --log-level=WARN ./metadata ./trace.bin | grep "ble.connected"
```

### Convert to JSON for post-processing
```bash
babeltrace2 --plugin-path=~/.local/lib/babeltrace2/plugins \
  --log-level=WARN \
  --output=json \
  ./metadata ./trace.bin > trace.json
```

## Notes

- Packet format is CTF 1.8 standard, compatible with all CTF analysis tools
- All integers are little-endian per trace configuration
- Timestamps are monotonic milliseconds (FreeRTOS xTaskGetTickCount)
- String fields use length-prefixed null-terminated format
- Events are buffered; call `barectf_close_packet()` to finalize and send packets
- The context is stateless; you can have multiple contexts tracing different things
