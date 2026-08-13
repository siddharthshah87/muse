# Agent guide — Margin monorepo

Guidance for AI coding agents (and humans) working in this repository. Read this
before making changes.

## What this project is

**Margin** is a two-device AI reading companion:

- **X4 Pro** — an ESP32-S3 e-reader. Primary visual reading surface. Firmware
  lives in [firmware-x4/](firmware-x4/) and is **Muse**, our **fork of
  CrossPoint** (the existing XTEINK reader firmware). See
  [docs/forking.md](docs/forking.md).
- **iPhone app** — the invisible compute + audio brain. Lives in [ios/](ios/)
  and is expected to **fork/reuse CrossX** (the existing XTEINK companion app).
  Requires macOS + Xcode to build.
- **shared/** — the cross-device contract: canonical locator + BLE/Wi-Fi event
  schemas. This is the source of truth both sides must agree on.

The full product spec is [docs/product-spec.md](docs/product-spec.md).

## We are forking upstream projects — be mindful

Both device halves start from existing code, not greenfield. This shapes how we
work:

- **Isolate our changes.** Keep Margin-specific code in clearly named modules
  (e.g. `firmware-x4/src/device_protocol/`, `locator/`, `playback_overlay/`)
  rather than editing upstream reader internals in place. Minimize divergence so
  we can pull upstream improvements.
- **Do not rewrite the reader engine.** Integrate through the smallest possible
  seams. Prefer additive hooks over refactors.
- **Track provenance of forked code.** Record the upstream commit/tag we forked
  from and keep a changelog of our deltas (see [docs/forking.md](docs/forking.md)).
- **Upstream generic fixes** where the license permits, keep proprietary
  product logic local.
- **License/architecture review comes before deep coupling** — especially for
  CrossX. Confirm license compatibility before importing large chunks.

## Golden rules for the device

1. **Never write to device flash without a verified full backup.** The factory
   backup + recovery procedure is [docs/recovery-x4.md](docs/recovery-x4.md).
   Backups live in `backups/` (git-ignored).
2. The X4 Pro is an **ESP32-S3 with native USB** (VID `303A`, PID `1001`),
   exposing a CDC serial port and a JTAG debug unit. No external USB-serial
   bridge.
3. Treat the connected device as **production hardware**. Read-only ops
   (`chip_id`, `flash_id`, `read_flash`) are fine; writes require explicit
   human go-ahead.

## Repository conventions

- **Monorepo.** Firmware, iOS, shared contracts, services, evals, tooling, and
  docs live together. Cross-cutting changes (e.g. a protocol event) should touch
  `shared/` first, then both consumers.
- **Cross-platform tooling.** Device scripts are **Python** (single source of
  truth) driven by a **bash** bootstrap that runs on Ubuntu, macOS, and Windows
  (Git Bash). Do not reintroduce platform-specific script duplicates. See
  [tools/](tools/).
- **Canonical locator is sacred.** Any code touching text positions must use the
  normalized locator defined in `shared/canonicalization/` — never rendered page
  numbers. Firmware and iOS must normalize identically.
- **Privacy boundaries are product requirements, not options.** Ambient audio
  never leaves the phone; only explicit push-to-talk uploads mic audio. See
  [docs/privacy.md](docs/privacy.md).

## Environment notes

- **Firmware** work runs anywhere (esptool now; **PlatformIO/pioarduino** for
  custom CrossPoint builds later).
- **iOS** work requires a **Mac**; it cannot be built on Windows/Linux.
- Set up any machine with [docs/setup.md](docs/setup.md).

## Current phase

**Phase 0 — hardware proof** (see [docs/roadmap.md](docs/roadmap.md)): safely own
the device stack (backup, identify, custom boot) before building features.
