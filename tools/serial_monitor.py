#!/usr/bin/env python3
"""Reset the X4 Pro into its app and stream the serial boot log.

Cross-platform dev helper. Uses esptool to reset the ESP32-S3 (its native
USB-Serial/JTAG doesn't reset via plain DTR/RTS), then captures serial output.

Usage:
    python tools/serial_monitor.py [--seconds 15] [--baud 115200] [--no-reset]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

from _device_common import ESP_PID, ESP_VID


def _find_port() -> str | None:
    try:
        from serial.tools import list_ports
    except Exception:
        return None
    esp = [p.device for p in list_ports.comports()
           if getattr(p, "vid", None) == ESP_VID and getattr(p, "pid", None) == ESP_PID]
    if esp:
        return esp[0]
    ports = [p.device for p in list_ports.comports()]
    return ports[0] if ports else None


def main() -> int:
    ap = argparse.ArgumentParser(description="Reset the X4 Pro and stream its boot log.")
    ap.add_argument("--seconds", type=float, default=15.0)
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--no-reset", action="store_true", help="Just read; do not reset first.")
    args = ap.parse_args()

    import serial  # from pyserial (esptool dep)

    port = _find_port()
    if not port:
        print("No serial port found.", file=sys.stderr)
        return 1

    if not args.no_reset:
        # esptool handles the USB-Serial/JTAG reset sequence correctly.
        subprocess.run(
            [sys.executable, "-m", "esptool", "--port", port,
             "--after", "hard_reset", "--connect-attempts", "2", "chip-id"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

    # Reopen ASAP after the reset re-enumerates the native USB.
    s = None
    for _ in range(80):
        p = _find_port()
        if p:
            try:
                s = serial.Serial(p, args.baud, timeout=1)
                break
            except Exception:
                pass
        time.sleep(0.1)
    if not s:
        print("Could not open serial after reset.", file=sys.stderr)
        return 1

    print(f"=== boot log ({port} @ {args.baud}, {args.seconds:.0f}s) ===")
    end = time.time() + args.seconds
    total = 0
    while time.time() < end:
        d = s.read(8192)
        if d:
            total += len(d)
            sys.stdout.write(d.decode("utf-8", "replace"))
            sys.stdout.flush()
    s.close()
    print(f"\n=== captured {total} bytes ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
