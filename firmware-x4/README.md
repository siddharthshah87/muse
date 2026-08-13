# firmware-x4 — X4 Pro firmware (ESP32-S3)

A **fork of CrossPoint** (the XTEINK reader firmware) with Margin-specific
additions kept in isolated modules. See [../docs/forking.md](../docs/forking.md)
and [../docs/hardware.md](../docs/hardware.md).

> Upstream not yet imported. Do the license/architecture review and record the
> fork ref in [../docs/forking.md](../docs/forking.md) before importing.

## Margin modules (isolated from upstream)

| Module | Responsibility |
|--------|----------------|
| `src/reader_integration/` | Thin hooks into the CrossPoint reader engine (no rewrites). |
| `src/locator/` | Canonical locator engine: rendered spans → normalized offsets. |
| `src/playback_overlay/` | Active-phrase highlight via E Ink partial refresh. |
| `src/device_protocol/` | BLE control/state service (+ Wi-Fi debug endpoint). |
| `src/annotations/` | Highlight/note/selection UI + durable outbound event queue. |

## Golden rule

Never write to device flash without a verified factory backup
([../docs/recovery-x4.md](../docs/recovery-x4.md)).

Build tooling: `esptool` now (backup/flash); **PlatformIO/pioarduino** (the
CrossPoint build system) added when we build a custom image.
