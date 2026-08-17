# Margin Firmware Tracing

CTF (Common Trace Format) tracing for the Margin X4 Pro firmware using **barectf** and **Trace Compass**.

## Architecture

```
ESP32-S3 firmware
  └── barectf generated C tracer   ← writes CTF binary packets to SRAM ring
  └── muse_trace_backend.c         ← ring buffer + USB-CDC flush
        │
        │  serial 'T\n' trigger
        ▼
tools/tracing/collect.py           ← frames packets → CTF directory on disk
        │
        ▼
Eclipse Trace Compass               ← timeline, swimlanes, statistics
babeltrace2                         ← CLI query / scripting
```

## Quick Start

### 1. Install dependencies (one-time)

```bash
# Host tools
cd muse/
python3 -m venv .venv-tracing
.venv-tracing/bin/pip install pyserial

# Trace Compass (GUI)
# Download from https://tracecompass.org — unzip and run TraceCompass

# babeltrace2 (CLI)
sudo apt install babeltrace2       # Ubuntu/Debian
brew install babeltrace            # macOS
```

### 2. Build and flash tracing firmware

```bash
cd firmware-x4/crosspoint
~/.platformio/penv/bin/pio run -e x4pro -t upload
```

### 3. Capture a trace

Connect the X4 Pro via USB, open a book, turn some pages, then:

```bash
cd tools/tracing
python3 collect.py
# Device responds, writes: trace-20260816-221200/
```

Or keep auto-capturing every 5 seconds:
```bash
python3 collect.py --continuous --out ./live-trace
```

### 4. View in Trace Compass

1. Launch Trace Compass
2. **File → Open Trace**
3. Select the `trace-<timestamp>/` directory
4. The **Control Flow** view shows task spawning
5. The **Events** table shows every `ble.*` and `reader.*` event with timestamps

### 5. Query with babeltrace2

```bash
# Print all events
babeltrace2 trace-20260816-221200/

# Show only BLE events
babeltrace2 trace-20260816-221200/ | grep ble

# Time between ble.init_called and ble.adv_start
babeltrace2 trace-20260816-221200/ --component=sink.text.details
```

## Events

| Event | Fields | Description |
|-------|--------|-------------|
| `ble.init_called` | `free_heap` | `MuseBleServer::init()` entered |
| `ble.task_spawn` | `success` | `xTaskCreate` result (1=ok, 0=fail) |
| `ble.task_start` | `core_id` | `bleInitTask` body reached |
| `ble.nimble_init_done` | — | `NimBLEDevice::init()` returned |
| `ble.service_created` | — | GATT service registered |
| `ble.adv_start` | — | BLE advertising started |
| `ble.connected` | `conn_handle` | Companion app connected |
| `ble.disconnected` | `conn_handle`, `reason` | Companion disconnected |
| `ble.notify_page` | `text_len`, `chunks`, `initialized`, `connected` | Page text send attempted |
| `reader.save_progress` | `spine`, `page`, `offset` | `saveProgress()` called |
| `reader.text_extracted` | `length` | Page text extracted |
| `reader.render_done` | `duration_ms` | Page render complete |
| `sys.heap_mark` | `free_bytes`, `min_free_bytes` | Heap snapshot |
| `sys.task_create` | `name`, `stack_bytes`, `result` | FreeRTOS task created |

## Regenerating C code after adding events

```bash
cd tools/tracing
# Edit muse-trace.yaml to add events
.venv-tracing/bin/barectf generate \
  --code-dir=generated \
  --headers-dir=generated \
  --metadata-dir=generated \
  muse-trace.yaml
# Commit the generated/ files
```

## Flush protocol

The device sends raw CTF packets over USB-CDC, framed for reliable extraction:

```
MUSE_CTF_BEGIN\n
<4-byte LE uint32: packet count>
<packet_count × 512 bytes: raw CTF packets>
MUSE_CTF_END\n
```

Trigger by sending `T\n` to the serial port (collect.py does this automatically).

## Ring buffer

- 16 packets × 512 bytes = 8 KB SRAM
- Oldest packet is evicted when full (circular)
- After flush, ring is reset — collect frequently during active testing
