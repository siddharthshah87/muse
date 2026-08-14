"""Shared helpers for the Margin device tools (cross-platform).

Single source of truth for locating esptool and auto-detecting the X4 Pro's
serial port on Windows (incl. Git Bash), Ubuntu, and macOS.
"""
from __future__ import annotations

import pathlib
import sys

# ESP32-S3 native USB identifiers (Espressif).
ESP_VID = 0x303A
ESP_PID = 0x1001

# Prefer the project venv's Python (esptool v5+, uses write-flash / usb_reset
# syntax) over the system Python (may have esptool v4 with write_flash syntax).
_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
_VENV_PYTHON = _REPO_ROOT / ".venv" / "bin" / "python"
_ESPTOOL_PYTHON = str(_VENV_PYTHON) if _VENV_PYTHON.exists() else sys.executable


def esptool_cmd(args: list[str]) -> list[str]:
    """Return an argv list that invokes esptool via the venv interpreter."""
    return [_ESPTOOL_PYTHON, "-m", "esptool", *args]


def list_ports():
    """Return a list of pyserial ListPortInfo objects, or [] if unavailable."""
    try:
        from serial.tools import list_ports  # provided by esptool's pyserial dep
    except Exception:
        return []
    return list(list_ports.comports())


def pick_port() -> str | None:
    """Best-effort auto-detect of the X4 Pro serial port.

    Prefers a port whose USB VID/PID matches the ESP32-S3 native USB. Falls back
    to the sole available *USB* port if there is exactly one.  Built-in kernel
    serial ports (/dev/ttyS*, /dev/ttyAMA*, COM1-COM4 on Windows) are excluded
    from the fallback — they have no USB VID and are never the X4 Pro.
    """
    ports = list_ports()
    if not ports:
        return None

    # VID/PID exact match — most reliable.
    esp = [p for p in ports if getattr(p, "vid", None) == ESP_VID and getattr(p, "pid", None) == ESP_PID]
    if len(esp) >= 1:
        if len(esp) > 1:
            print(f"Multiple ESP32-S3 ports; using {esp[0].device}. Override with --port.", file=sys.stderr)
        return esp[0].device

    # Fallback: any port that has a USB VID (filters out ttyS*, ttyAMA*, COM1-4…)
    usb = [p for p in ports if getattr(p, "vid", None) is not None]
    if len(usb) == 1:
        return usb[0].device
    if len(usb) > 1:
        print("Multiple USB serial ports found; specify one with --port:", file=sys.stderr)
        for p in usb:
            vid = f"{p.vid:04X}" if p.vid else "????"
            pid = f"{p.pid:04X}" if p.pid else "????"
            print(f"  {p.device}  VID:{vid} PID:{pid}  {p.description}", file=sys.stderr)
        return None

    return None
