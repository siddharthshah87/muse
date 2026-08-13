# firmware-x4 — Muse (X4 Pro firmware, ESP32-S3)

**Muse** is Margin's X4 Pro firmware: a **fork of CrossPoint** (the XTEINK reader
firmware) with Margin-specific additions kept in isolated modules. See
[../docs/forking.md](../docs/forking.md) and
[../docs/hardware.md](../docs/hardware.md).

> **Working tree is not vendored.** The CrossPoint clone (~60 MB) lives at
> `firmware-x4/crosspoint/` and is **git-ignored**. Reconstruct it on any machine
> with `./tools/setup-crosspoint.sh` (clones CrossPoint, pins `freeink-sdk`, and
> applies our tracked overlay [`firmware-x4/platformio.local.ini`](platformio.local.ini),
> which adds the `x4pro` build env). Then build with `./tools/build-firmware.sh`.

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
