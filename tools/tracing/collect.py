#!/usr/bin/env python3
"""
collect.py — Margin CTF trace collector
========================================
Sends 'T' to the device, captures the framed binary CTF stream from
/dev/ttyACM0, and writes a CTF directory that Trace Compass or babeltrace2
can open directly.

Usage:
    python3 collect.py                         # auto-detect port
    python3 collect.py --port /dev/ttyACM0    # explicit port
    python3 collect.py --out ./my-trace        # output directory (default: trace-<ts>/)
    python3 collect.py --continuous            # keep polling every 5 s

Trace Compass:
    File → Open Trace → select the output directory

babeltrace2 (quick CLI):
    babeltrace2 ./trace-<ts>/
"""

import argparse
import glob
import os
import serial
import shutil
import struct
import sys
import time
from datetime import datetime
from pathlib import Path

PACKET_SIZE   = 512
FRAME_BEGIN   = b"MUSE_CTF_BEGIN"
FRAME_END     = b"MUSE_CTF_END"
BAUD_RATE     = 115200
TRIGGER_BYTE  = b"T\n"

# CTF metadata template — must match muse-trace.yaml
CTF_METADATA = """\
/* CTF 1.8 */

trace {{
    major = 1;
    minor = 8;
    uuid = "8a1fcd82-3b4e-4e1a-9c0a-000000000001";
    byte_order = le;
    packet.header := struct {{
        uint32_t magic;
        uint8_t  uuid[16];
        uint32_t stream_id;
    }};
}};

env {{
    domain = "bare-metal";
    tracer_name = "barectf";
    tracer_major = 3;
    tracer_minor = 1;
}};

clock {{
    name = mono_ms;
    freq = 1000;
    precision = 1;
    offset_s = 0;
    offset = 0;
    absolute = FALSE;
    description = "FreeRTOS tick counter in milliseconds";
}};

typealias integer {{ size = 64; align = 8; signed = false; map = clock.mono_ms.value; }} := uint64_clock_mono_ms_t;

stream {{
    id = 0;
    packet.context := struct {{
        uint64_clock_mono_ms_t timestamp_begin;
        uint64_clock_mono_ms_t timestamp_end;
        uint64_t               content_size;
        uint64_t               packet_size;
    }};
    event.header := struct {{
        uint32_t id;
        uint64_clock_mono_ms_t timestamp;
    }};
}};

event {{
    id = 0;
    name = "ble.init_called";
    stream_id = 0;
    fields := struct {{ uint32_t free_heap; }};
}};

event {{
    id = 1;
    name = "ble.task_spawn";
    stream_id = 0;
    fields := struct {{ uint8_t success; }};
}};

event {{
    id = 2;
    name = "ble.task_start";
    stream_id = 0;
    fields := struct {{ uint8_t core_id; }};
}};

event {{
    id = 3;
    name = "ble.nimble_init_done";
    stream_id = 0;
    fields := struct {{}};
}};

event {{
    id = 4;
    name = "ble.service_created";
    stream_id = 0;
    fields := struct {{}};
}};

event {{
    id = 5;
    name = "ble.adv_start";
    stream_id = 0;
    fields := struct {{}};
}};

event {{
    id = 6;
    name = "ble.connected";
    stream_id = 0;
    fields := struct {{ uint16_t conn_handle; }};
}};

event {{
    id = 7;
    name = "ble.disconnected";
    stream_id = 0;
    fields := struct {{ uint16_t conn_handle; uint8_t reason; }};
}};

event {{
    id = 8;
    name = "ble.notify_page";
    stream_id = 0;
    fields := struct {{ uint32_t text_len; uint8_t chunks; uint8_t initialized; uint8_t connected; }};
}};

event {{
    id = 9;
    name = "reader.save_progress";
    stream_id = 0;
    fields := struct {{ uint16_t spine; uint16_t page; uint32_t offset; }};
}};

event {{
    id = 10;
    name = "reader.text_extracted";
    stream_id = 0;
    fields := struct {{ uint32_t length; }};
}};

event {{
    id = 11;
    name = "reader.render_done";
    stream_id = 0;
    fields := struct {{ uint32_t duration_ms; }};
}};

event {{
    id = 12;
    name = "sys.heap_mark";
    stream_id = 0;
    fields := struct {{ uint32_t free_bytes; uint32_t min_free_bytes; }};
}};

event {{
    id = 13;
    name = "sys.task_create";
    stream_id = 0;
    fields := struct {{ string name; uint32_t stack_bytes; uint8_t result; }};
}};
"""


def find_port():
    candidates = glob.glob("/dev/ttyACM*") + glob.glob("/dev/tty.usb*")
    if not candidates:
        sys.exit("No serial port found. Plug in the X4 Pro and try again.")
    return sorted(candidates)[0]


def collect_once(port: str, out_dir: Path) -> bool:
    print(f"[collect] Connecting to {port} …")
    try:
        ser = serial.Serial(port, BAUD_RATE, timeout=5)
    except serial.SerialException as e:
        print(f"[collect] ERROR: {e}")
        return False

    time.sleep(0.3)
    ser.reset_input_buffer()
    ser.write(TRIGGER_BYTE)
    ser.flush()

    print("[collect] Waiting for MUSE_CTF_BEGIN …")
    raw = b""
    deadline = time.time() + 10
    while time.time() < deadline:
        raw += ser.read(ser.in_waiting or 1)
        if FRAME_BEGIN in raw:
            break
    else:
        print("[collect] Timed out waiting for frame start.")
        ser.close()
        return False

    # Trim everything before FRAME_BEGIN
    raw = raw[raw.index(FRAME_BEGIN) + len(FRAME_BEGIN):]

    # Read 4-byte packet count
    while len(raw) < 4 and time.time() < deadline:
        raw += ser.read(4 - len(raw))
    if len(raw) < 4:
        print("[collect] Timed out reading count.")
        ser.close()
        return False

    # Skip leading newline if present
    if raw[0:1] == b"\n":
        raw = raw[1:]
    while len(raw) < 4:
        raw += ser.read(4 - len(raw))

    count = struct.unpack_from("<I", raw[:4])[0]
    raw = raw[4:]
    print(f"[collect] Expecting {count} packets ({count * PACKET_SIZE} bytes) …")

    total_needed = count * PACKET_SIZE
    deadline2 = time.time() + 15
    while len(raw) < total_needed and time.time() < deadline2:
        raw += ser.read(total_needed - len(raw))

    ser.close()

    if len(raw) < total_needed:
        print(f"[collect] Short read: got {len(raw)} of {total_needed} bytes.")
        return False

    packets = raw[:total_needed]

    # Write CTF directory
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_path = out_dir / "metadata"
    stream_path = out_dir / "stream"

    meta_path.write_text(CTF_METADATA)
    stream_path.write_bytes(packets)

    print(f"[collect] ✓ Wrote {count} packets → {out_dir}")
    print(f"          Open in Trace Compass: File → Open Trace → {out_dir}")
    print(f"          babeltrace2: babeltrace2 {out_dir}")
    return True


def main():
    ap = argparse.ArgumentParser(description="Collect CTF trace from Margin X4 Pro")
    ap.add_argument("--port", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--continuous", action="store_true",
                    help="Keep polling every 5 seconds")
    args = ap.parse_args()

    port = args.port or find_port()
    interval = 0

    while True:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        out_dir = Path(args.out) if args.out else Path(f"trace-{ts}")
        collect_once(port, out_dir)
        if not args.continuous:
            break
        print(f"[collect] Sleeping 5 s …")
        time.sleep(5)


if __name__ == "__main__":
    main()
