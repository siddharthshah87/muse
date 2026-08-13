#!/usr/bin/env python3
"""Restore a full factory-flash image to the X4 Pro (ESP32-S3).

Cross-platform. Writes a complete flash image (from tools/backup_flash.py) back
to offset 0, verifies the on-device hash, and hard-resets. This OVERWRITES the
device flash — use only with a known-good backup. See docs/recovery-x4.md.

Usage:
    python tools/restore_flash.py --image backups/x4pro-factory-<stamp>.bin
                                  [--port COM4] [--baud 460800]
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys

from _device_common import esptool_cmd, pick_port
import subprocess


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description="Restore a full flash image to the X4 Pro.")
    ap.add_argument("--image", required=True, help="Path to the full-flash .bin to restore.")
    ap.add_argument("--port", help="Serial port (auto-detected if omitted).")
    ap.add_argument("--baud", type=int, default=460800)
    args = ap.parse_args()

    if not os.path.isfile(args.image):
        print(f"Image not found: {args.image}", file=sys.stderr)
        return 1

    # If a sibling .sha256 exists, verify the image before writing it.
    sha_path = os.path.splitext(args.image)[0] + ".sha256"
    if os.path.isfile(sha_path):
        want = open(sha_path).read().split()[0].strip().lower()
        got = _sha256(args.image)
        if want != got:
            print(f"Image checksum mismatch!\n want {want}\n got  {got}", file=sys.stderr)
            return 1
        print("Image checksum OK.")

    port = args.port or pick_port()
    if not port:
        print("No serial port found. Connect the X4 Pro.", file=sys.stderr)
        return 1

    size = os.path.getsize(args.image)
    print(f"Restoring {args.image} ({size} bytes) to {port} @ {args.baud} ...")
    # write_flash performs an on-device SHA verify ("Hash of data verified").
    # We rely on that rather than a separate verify_flash, whose read path can
    # stall on the ESP32-S3 native USB-Serial/JTAG (see docs/hardware.md).
    rc = subprocess.call(esptool_cmd([
        "--port", port, "--baud", str(args.baud),
        "write_flash", "0x0", args.image,
    ]))
    if rc != 0:
        print("write_flash failed. Retry with a lower --baud.", file=sys.stderr)
        return rc

    print("Restore complete (write_flash hash-verified). Device hard-reset into restored image.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
