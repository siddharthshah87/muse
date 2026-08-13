#!/usr/bin/env python3
"""Read-only identification of the connected X4 Pro (ESP32-S3).

Cross-platform (Windows / Ubuntu / macOS). Runs esptool's non-destructive
identify commands. This resets the chip into download mode but does NOT modify
flash. Safe to run any time the device is connected.

Usage:
    python tools/identify_device.py [--port PORT]
"""
from __future__ import annotations

import argparse
import subprocess
import sys

from _device_common import esptool_cmd, pick_port


def main() -> int:
    ap = argparse.ArgumentParser(description="Identify the connected X4 Pro (read-only).")
    ap.add_argument("--port", help="Serial port (e.g. COM4, /dev/ttyACM0). Auto-detected if omitted.")
    args = ap.parse_args()

    port = args.port or pick_port()
    if not port:
        print("No serial port found. Is the X4 Pro connected and powered on?", file=sys.stderr)
        return 1

    print(f"== esptool chip identify on {port} (read-only) ==")
    rc = subprocess.call(esptool_cmd(["--port", port, "chip_id"]))
    if rc != 0:
        return rc
    print()
    return subprocess.call(esptool_cmd(["--port", port, "flash_id"]))


if __name__ == "__main__":
    raise SystemExit(main())
