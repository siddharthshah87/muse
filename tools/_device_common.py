"""Shared helpers for the Margin device tools (cross-platform).

Single source of truth for locating esptool and auto-detecting the X4 Pro's
serial port on Windows (incl. Git Bash), Ubuntu, and macOS.
"""
from __future__ import annotations

import sys

# ESP32-S3 native USB identifiers (Espressif).
ESP_VID = 0x303A
ESP_PID = 0x1001


def esptool_cmd(args: list[str]) -> list[str]:
    """Return an argv list that invokes esptool via the current interpreter."""
    return [sys.executable, "-m", "esptool", *args]


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
    to the sole available port if there is exactly one.
    """
    ports = list_ports()
    if not ports:
        return None

    esp = [p for p in ports if getattr(p, "vid", None) == ESP_VID and getattr(p, "pid", None) == ESP_PID]
    if len(esp) >= 1:
        if len(esp) > 1:
            print(f"Multiple ESP32-S3 ports; using {esp[0].device}. Override with --port.", file=sys.stderr)
        return esp[0].device

    if len(ports) == 1:
        return ports[0].device

    print("Multiple serial ports found; specify one with --port:", file=sys.stderr)
    for p in ports:
        print(f"  {p.device}  {p.description}", file=sys.stderr)
    return None
