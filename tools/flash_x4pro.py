#!/usr/bin/env python3
"""Flash Muse firmware to app0 on the X4 Pro (ESP32-S3).

Performs two writes — nothing else is touched:
  1. firmware.bin  → app0  @ 0x10000
  2. otadata blob  → 0xe000  (seq=1, state=VALID → bootloader selects ota_0)

The OEM image stays physically intact in app1 @ 0x7F0000.  Full recovery is
always possible via tools/restore_flash.py + the factory backup.

Usage:
  python tools/flash_x4pro.py
  python tools/flash_x4pro.py --port /dev/ttyACM0
  python tools/flash_x4pro.py --port COM4
  python tools/flash_x4pro.py --port /dev/ttyACM0 --firmware path/to/firmware.bin
  python tools/flash_x4pro.py --dry-run   # print what would be flashed, exit
"""
from __future__ import annotations

import argparse
import pathlib
import struct
import subprocess
import sys
import zlib

# ---------------------------------------------------------------------------
# Project layout
# ---------------------------------------------------------------------------
REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_FIRMWARE = (
    REPO_ROOT / "firmware-x4" / "crosspoint" / ".pio" / "build" / "x4pro" / "firmware.bin"
)

# ---------------------------------------------------------------------------
# X4 Pro partition offsets (must match firmware-x4/partitions_x4pro.csv)
# ---------------------------------------------------------------------------
OTADATA_OFFSET = 0x0E000
APP0_OFFSET    = 0x10000

# ---------------------------------------------------------------------------
# OTA select entry layout (ESP-IDF esp_ota_select_entry_t, 32 bytes)
#   uint32_t ota_seq;         // 4 — sequence number; odd → ota_0, even → ota_1
#   uint8_t  seq_label[20];   // 20 — unused, 0xFF
#   uint32_t ota_state;       // 4
#   uint32_t crc;             // 4 — CRC32 of the 28 bytes above
# ---------------------------------------------------------------------------
OTA_SECTOR_SIZE = 0x1000      # entries are sector-aligned within otadata
OTA_STATE_VALID = 0xFFFFFFFD  # already validated; no rollback countdown

# bootloader slot selection: slot = (seq - 1) % num_ota_parts
# With 2 OTA partitions: seq=1 → ota_0, seq=2 → ota_1, seq=3 → ota_0, …
OTA0_SEQ = 1  # smallest valid seq that maps to ota_0


def _crc32(data: bytes) -> int:
    """CRC32 matching esp_rom_crc32_le(UINT32_MAX, data, len)."""
    return zlib.crc32(data) & 0xFFFFFFFF


def _make_ota_entry(seq: int, state: int = OTA_STATE_VALID) -> bytes:
    """Build one 32-byte OTA select entry."""
    body = struct.pack("<I", seq) + b"\xff" * 20 + struct.pack("<I", state)
    return body + struct.pack("<I", _crc32(body))


def build_otadata() -> bytes:
    """Build the 8 KB otadata blob.

    Sector 0: ota_0 entry — seq=1, state=VALID → bootloader boots ota_0.
    Sector 1: all 0xFF (erased) → no competing ota_1 entry.

    With only one valid entry the bootloader cannot roll back to ota_1
    automatically; OEM is still recoverable via restore_flash.py.
    """
    entry0 = _make_ota_entry(OTA0_SEQ, OTA_STATE_VALID)
    sector0 = entry0 + b"\xff" * (OTA_SECTOR_SIZE - len(entry0))
    sector1 = b"\xff" * OTA_SECTOR_SIZE
    return sector0 + sector1


def run_esptool(port: str, args: list[str], *, dry_run: bool = False,
                after: str = "no-reset") -> None:
    cmd = [sys.executable, "-m", "esptool",
           "--chip", "esp32s3", "--port", port,
           "--before", "usb-reset", "--after", after,
           "--no-stub"] + args
    print("  $", " ".join(cmd))
    if not dry_run:
        subprocess.run(cmd, check=True)


def flash(port: str, firmware: pathlib.Path, *, dry_run: bool = False) -> None:
    # Write otadata as a temp file so esptool can read it
    otadata_path = firmware.parent / "otadata_x4pro.bin"
    blob = build_otadata()
    if not dry_run:
        otadata_path.write_bytes(blob)
        print(f"  otadata blob written to {otadata_path}  ({len(blob)} bytes)")
    else:
        print(f"  [dry-run] would write {len(blob)}-byte otadata blob to {otadata_path}")

    print()
    print("── Step 1: flash firmware.bin → app0 @ 0x10000 ──")
    run_esptool(port, ["write-flash", "--flash-mode", "dio", "--flash-size", "16MB",
                       hex(APP0_OFFSET), str(firmware)], dry_run=dry_run)

    print()
    print("── Step 2: write otadata → 0xe000 (boots ota_0), then reboot ──")
    run_esptool(port, ["write-flash", "--flash-mode", "dio", "--flash-size", "16MB",
                       hex(OTADATA_OFFSET), str(otadata_path)],
                dry_run=dry_run, after="hard-reset")

    if not dry_run:
        print()
        print("✓  Done. Device is rebooting into Muse (app0).")
        print("   OEM firmware remains intact in app1 @ 0x7F0000.")
        print("   To restore OEM: python tools/restore_flash.py")


def main() -> None:
    sys.path.insert(0, str(REPO_ROOT / "tools"))
    from _device_common import pick_port

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", help="Serial port (auto-detected if omitted)")
    parser.add_argument("--firmware", type=pathlib.Path, default=DEFAULT_FIRMWARE,
                        help=f"firmware.bin to flash (default: {DEFAULT_FIRMWARE})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print commands without flashing")
    args = parser.parse_args()

    fw = args.firmware.resolve()
    if not fw.exists():
        print(f"ERROR: firmware not found at {fw}", file=sys.stderr)
        print("Build first with:  ./tools/build-firmware.sh", file=sys.stderr)
        sys.exit(1)

    print(f"Firmware : {fw}  ({fw.stat().st_size:,} bytes)")

    port = args.port
    if not port:
        port = pick_port()
    if not port:
        print("ERROR: could not detect device port. Connect the X4 Pro and retry,", file=sys.stderr)
        print("       or specify --port explicitly.", file=sys.stderr)
        sys.exit(1)

    print(f"Port     : {port}")
    print(f"Dry-run  : {args.dry_run}")
    print()

    if not args.dry_run:
        resp = input("Flash Muse firmware to app0? OEM stays in app1. [y/N] ").strip().lower()
        if resp != "y":
            print("Aborted.")
            sys.exit(0)
        print()

    flash(port, fw, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
