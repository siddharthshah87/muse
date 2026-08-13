#!/usr/bin/env python3
"""Full factory-flash backup of the connected X4 Pro (ESP32-S3).

Cross-platform (Windows / Git Bash / Ubuntu / macOS). Reads the ENTIRE flash to
a timestamped .bin under backups/ and writes a .sha256 checksum and a .json
manifest (chip, MAC, flash size, tool versions). This is READ-ONLY with respect
to the device. Run and verify this BEFORE ever writing to the device. See
docs/recovery-x4.md to restore.

Usage:
    python tools/backup_flash.py [--port PORT] [--baud 460800]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import subprocess
import sys

from _device_common import esptool_cmd, pick_port

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(REPO_ROOT, "backups")


def _run_capture(args: list[str]) -> str:
    proc = subprocess.run(args, capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.stdout + proc.stderr


def _first_match(pattern: str, text: str) -> str | None:
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


def _read_flash_chunked(port: str, baud: int, size_bytes: int, chunk: int,
                        retries: int, out_path: str) -> bool:
    """Read flash in fixed-size chunks with per-chunk retries; concatenate to out_path."""
    with open(out_path, "wb") as out:
        offset = 0
        while offset < size_bytes:
            length = min(chunk, size_bytes - offset)
            part = f"{out_path}.part"
            ok = False
            for attempt in range(1, retries + 1):
                pct = 100.0 * offset / size_bytes
                print(f"  [{pct:5.1f}%] read 0x{offset:08x} +{length} "
                      f"(attempt {attempt}/{retries})")
                rc = subprocess.call(esptool_cmd([
                    "--port", port, "--baud", str(baud), "--no-stub",
                    "read_flash", str(offset), str(length), part,
                ]))
                if rc == 0 and os.path.exists(part) and os.path.getsize(part) == length:
                    ok = True
                    break
            if not ok:
                if os.path.exists(part):
                    os.remove(part)
                return False
            with open(part, "rb") as pf:
                out.write(pf.read())
            os.remove(part)
            offset += length
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Full factory-flash backup of the X4 Pro.")
    ap.add_argument("--port", help="Serial port (e.g. COM4, /dev/ttyACM0). Auto-detected if omitted.")
    ap.add_argument("--baud", type=int, default=460800, help="Read baud rate (default 460800).")
    ap.add_argument("--chunk-mb", type=int, default=4, help="Chunk size in MB for reads (default 4).")
    ap.add_argument("--retries", type=int, default=4, help="Per-chunk retry count (default 4).")
    args = ap.parse_args()

    port = args.port or pick_port()
    if not port:
        print("No serial port found. Connect the X4 Pro.", file=sys.stderr)
        return 1

    os.makedirs(BACKUP_DIR, exist_ok=True)
    print(f"Using port {port} at {args.baud} baud.")

    info = _run_capture(esptool_cmd(["--port", port, "flash_id"]))
    size_str = _first_match(r"Detected flash size:\s*(\d+)MB", info)
    if not size_str:
        print("Could not detect flash size. Re-run identify and pass size manually.", file=sys.stderr)
        return 1
    size_mb = int(size_str)
    size_bytes = size_mb * 1024 * 1024
    print(f"Detected flash size: {size_mb}MB ({size_bytes} bytes)")

    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.join(BACKUP_DIR, f"x4pro-factory-{stamp}")
    bin_path = f"{base}.bin"

    # The ESP32-S3 native USB-Serial/JTAG can stall on one large continuous
    # read, so read in chunks with per-chunk retries and concatenate.
    print(f"Reading full flash in {args.chunk_mb}MB chunks -> {bin_path} ...")
    chunk = args.chunk_mb * 1024 * 1024
    if not _read_flash_chunked(port, args.baud, size_bytes, chunk, args.retries, bin_path):
        print("Flash read failed after retries.", file=sys.stderr)
        return 1
    actual = os.path.getsize(bin_path)
    if actual != size_bytes:
        print(f"Size mismatch: read {actual} of {size_bytes} bytes.", file=sys.stderr)
        return 1

    print("Computing SHA-256...")
    h = hashlib.sha256()
    with open(bin_path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    digest = h.hexdigest()
    with open(f"{base}.sha256", "w", encoding="ascii") as f:
        f.write(f"{digest}  {os.path.basename(bin_path)}\n")

    esptool_ver = subprocess.run(esptool_cmd(["version"]), capture_output=True, text=True).stdout.strip().splitlines()
    manifest = {
        "created_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "file": os.path.basename(bin_path),
        "sha256": digest,
        "size_bytes": size_bytes,
        "flash_size_mb": size_mb,
        "chip": _first_match(r"Chip type:\s*(.+)", info),
        "mac": _first_match(r"MAC:\s*(.+)", info),
        "port": port,
        "baud": args.baud,
        "esptool": esptool_ver[0] if esptool_ver else None,
        "note": "Full factory flash dump. See docs/recovery-x4.md to restore.",
    }
    with open(f"{base}.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("\nBackup complete.")
    print(f"  bin:      {bin_path}")
    print(f"  sha256:   {base}.sha256")
    print(f"  manifest: {base}.json")
    print("\nIMPORTANT: copy this backup off-machine before modifying the device.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
