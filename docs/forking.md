# Fork strategy — CrossPoint (firmware) & CrossX (iOS)

Margin is **not greenfield**. Both device halves start from existing XTEINK
projects. This document defines how we fork, isolate, and maintain them so we get
a working product quickly without inheriting an unmaintainable divergence.

**Names:** the product/system is **Margin**. Our X4 Pro firmware fork of
CrossPoint is named **Muse** (lives in [firmware-x4/](../firmware-x4/)). The iOS
half is the **Margin app** (forking/reusing CrossX).

## What we are forking

| Half | Upstream | Our fork | Language / platform |
|------|----------|----------|---------------------|
| X4 Pro firmware (**Muse**) | **CrossPoint** ([crosspoint-reader/crosspoint-reader](https://github.com/crosspoint-reader/crosspoint-reader), **MIT**) | [firmware-x4/](../firmware-x4/) | C/C++ on **PlatformIO/pioarduino + Arduino** (ESP32-S3) |
| iPhone companion (**Margin app**) | **CrossX** ([jtvargas/crosspoint-app](https://github.com/jtvargas/crosspoint-app), **MIT**, community/3rd-party) | [ios/](../ios/) | SwiftUI, multiplatform (requires macOS + **Xcode 26 / iOS 26**) |

> **CrossPoint is MIT-licensed** — permissive, we can fork freely. **CrossX** is
> also **MIT** but is a **community app by jtvargas, not an official CrossPoint
> project** — reuse it for scaffolding (device comms, EPUB pipeline, Share
> Extension), but it is **HTTP/WiFi-only (no BLE)** and has none of Margin's
> AI/audio/locator core. Do an architecture review before deep coupling.
>
> **Good news: the X4 Pro is already supported.** The `freeink-sdk` submodule
> ([Free-Ink/freeink-sdk](https://github.com/Free-Ink/freeink-sdk)) ships a
> hardware-confirmed **`BoardConfig::XTEINK_X4_PRO`** profile
> (`-DFREEINK_DEVICE_X4PRO=1`, sample `[env:x4pro]`). See
> [freeink-sdk/docs/xteink-x4pro-support.md](https://github.com/Free-Ink/freeink-sdk/blob/main/docs/xteink-x4pro-support.md)
> and the confirmed peripheral map in [hardware.md](hardware.md).

## Principles

1. **Isolate Margin code.** Keep our additions in dedicated modules, not spread
   through upstream internals:
   - Firmware: `device_protocol/`, `locator/`, `playback_overlay/`,
     `annotations/`, `reader_integration/` (thin hooks only).
   - iOS: `DeviceBridge/`, `Narration/`, `Conversation/`, `ReadingMemory/`,
     `Sync/` — reuse CrossX for discovery, file transfer, and the Share
     Extension.
2. **Do not rewrite the reader engine.** Integrate through the smallest seams.
   Additive hooks beat refactors. The reader must keep working as a plain reader
   if Margin features are disabled.
3. **Minimize divergence.** Prefer configuration and new files over edits to
   upstream files. Every upstream edit is a future merge cost.
4. **Isolate the Pro HAL.** X4 **Pro** support in CrossPoint may be
   immature/beta. Keep Pro hardware adaptation (touch, buttons, front-light,
   power, BLE) behind a hardware abstraction layer.
5. **Track our deltas.** Maintain a short changelog of every upstream file we
   touch and why (see below).

## Git approach (firmware): pinned clone + tracked overlay

CrossPoint is **not vendored**. `tools/setup-crosspoint.sh` clones it at a pinned
ref into the git-ignored `firmware-x4/crosspoint/`, pins `freeink-sdk`, then runs
`tools/apply-muse-overlay.sh`, which:

1. copies our build config (`platformio.local.ini`, `partitions_x4pro.csv`,
   `scripts/`) into the clone;
2. mirrors each Margin module in `firmware-x4/src/<module>/` to
   `crosspoint/src/<module>/`;
3. applies `firmware-x4/patches/*.patch` (our edits to upstream files),
   skipping any already applied and failing loudly on conflicts.

`tools/build-firmware.sh` re-runs the overlay before every build, so the tracked
files always win. To change an upstream hook: edit it in `crosspoint/`, then
regenerate its patch with `git -C firmware-x4/crosspoint diff HEAD -- <file> >
firmware-x4/patches/<NNNN-name>.patch`. To move to a new upstream ref, bump the
pins in `setup-crosspoint.sh`, re-clone, and fix any patch that no longer applies.

## Upstream provenance log

Record what we forked and every delta. Keep this table current.

| Component | Upstream ref (commit/tag) | Date | Notes |
|-----------|---------------------------|------|-------|
| CrossPoint | [crosspoint-reader/crosspoint-reader](https://github.com/crosspoint-reader/crosspoint-reader) `feat-x4-papermono-support` @ `a02ccd89` "Beta 22" (MIT), PR #2983 | 2026-08-14 | Firmware base. Contains official X4 Pro `[env:x4pro]` with display/touch/frontlight support. Pinned in `tools/setup-crosspoint.sh`. |
| freeink-sdk | [Free-Ink/freeink-sdk](https://github.com/Free-Ink/freeink-sdk) `main` @ `4ff75b2b` (submodule, merge of PR #36 X4 Pro USB support) | 2026-08-13 | HAL; provides `XTEINK_X4_PRO` profile. Pinned in `tools/setup-crosspoint.sh`. |
| CrossX | [jtvargas/crosspoint-app](https://github.com/jtvargas/crosspoint-app) `main` (MIT, community) | 2026-08-13 | iOS companion base. SwiftUI/MVVM. Xcode 26/iOS 26. HTTP/WiFi only. |

## CrossX reuse map & gaps (iOS)

CrossX is MVVM + protocol-oriented (`DeviceService` → `StockFirmwareService` /
`CrossPointFirmwareService`). What maps to Margin, and what's missing:

| Margin module | CrossX reuse |
|---------------|--------------|
| `DeviceBridge/` | `DeviceService` + `CrossPointFirmwareService` (HTTP), `DeviceDiscovery` (mDNS) |
| `Library/` | `EPUBBuilder`, file manager, SwiftData models (`Article`, `QueueItem`…) |
| `ShareExtension/` | `SendToX4ShareExtension` (fetch → extract → EPUB → send) |

**Net-new for Margin (not in CrossX):** BLE control channel, canonical locator,
narration/TTS + audio routing, ambient pause (VAD), realtime AI conversation,
reading memory / mind-map. CrossX transport is **HTTP over the device WiFi
hotspot only** — no BLE — so `DeviceBridge` must add the BLE path itself.

## CrossPoint ecosystem (useful siblings)

- **[crosspoint-simulator](https://github.com/crosspoint-reader/crosspoint-simulator)** (MIT) — run firmware **without flashing hardware**. Best way to iterate on our reader seams safely; protects the device.
- **[crosspoint-sync](https://github.com/crosspoint-reader/crosspoint-sync)** (MIT) — KoSync progress/stats server; reference (and possible host) for our `Sync` engine.
- **[community-sdk](https://github.com/crosspoint-reader/community-sdk)** / **[freeink-sdk](https://github.com/Free-Ink/freeink-sdk)** — the HAL; `freeink-sdk` is what we build against and provides `XTEINK_X4_PRO`.
- **[Murphy](https://github.com/crosspoint-reader/Murphy)** (MIT) — new-device bring-up docs/dumps; the template pattern for `xteink-x4pro-support.md` and our own findings.
- **[escape-hatch](https://github.com/crosspoint-reader/escape-hatch)** — 400 KB SD-card flasher, but **X3/X4 (ESP32-C3) only** — likely not X4 Pro/S3. Our factory-flash backup stays the primary recovery path.
- **[crosspoint-tools](https://github.com/crosspoint-reader/crosspoint-tools)** — website + WebSerial flasher + font builder (browser flashing may not cover S3 native USB-JTAG).
- Tangential: **calibre-plugins** (sideloading), **JPEGDEC** (vendored decoder dep), **crosspoint-fonts** (assets), **xteink-flasher** (archived).

## Known gaps for Margin

- **BLE is disabled in mainline** (`lib_ignore = BLE` in `platformio.ini`).
  **RESOLVED** in our overlay: `platformio.local.ini` adds NimBLE-Arduino and a
  controller-only BT sdkconfig; `MuseBleServer` (`device_protocol/`) uses it.
- **No X4 Pro env in crosspoint's `platformio.ini` yet** — ~~only C3 envs~~
  **RESOLVED**: PR #2983 (`feat-x4-papermono-support`) adds the official `[env:x4pro]`.
  We pin to that branch. Our `platformio.local.ini` repeats that env (PlatformIO
  replaces duplicate sections) and adds the partition table, NimBLE and
  `-DMUSE_BUILD=1`.
- **Dual-boot nuance**: the device boots **app1** (OEM). A custom build flashed to
  app0 @ `0x10000` only boots if `otadata` selects app0 — keeps OEM in app1 as a
  fallback. See [hardware.md](hardware.md).

### Delta changelog (files we changed in upstream)

| Component | File | Change | Reason | Upstreamable? |
|-----------|------|--------|--------|---------------|
| Muse overlay | `platformio.local.ini` (added) | New file — `[env:x4pro]` env: S3 board, X4 Pro device flags, correct partition table | CrossPoint has no x4pro env; using C3 table causes bootloops | No (product-specific) |
| Muse overlay | `partitions_x4pro.csv` (added) | X4 Pro partition layout: app 7.875 MB × 2, app1 @ 0x7F0000 | CrossPoint's `partitions.csv` is for the C3 (6.25 MB apps, app1 @ 0x650000) — mismatch causes bootloops | No (device-specific) |
| Muse modules | `src/device_protocol/` (added) | `MuseBleServer`, `ReadingState`, text trace ring | BLE page-text channel + locator state | No (product-specific) |
| `0001-api-reading-endpoint.patch` | `src/network/CrossPointWebServer.{h,cpp}` | `GET /api/reading` handler | Expose canonical locator over HTTP | Maybe (generic "current position" API) |
| `0002-reader-ble-page-hooks.patch` | `src/activities/reader/EpubReaderActivity.cpp` | After `saveProgress()`: update `ReadingState`, start BLE, notify page text | Narration sync | No |
| `0003-serial-trace-command.patch` | `src/main.cpp` | `CMD:TRACE` serial command dumps the trace ring | Debugging BLE on device | No |

## Non-goals for the fork

- No Kindle app, no DRM bypass on the X4 (spec Non-goals).
- No rewrite of the CrossPoint reader engine.
- No coupling core app design to CrossX internals before the license/architecture
  review.
