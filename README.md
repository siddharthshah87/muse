# Margin — AI Reading Companion (Monorepo)

Margin is a two-device reading system built around the **X4 Pro** (an ESP32-S3
e-reader) and an **iPhone** companion app. The X4 Pro is the primary visual
reading surface; the iPhone is the invisible compute + audio brain (TTS
narration, realtime voice AI discussion, note/mind-map synthesis, durable
memory). See [docs/product-spec.md](docs/product-spec.md) for the full product
specification.

> Status: **Phase 0 — hardware proof.** We are safely owning the device stack
> before modifying anything. See [docs/roadmap.md](docs/roadmap.md).

## Repository layout (monorepo)

This repository is a monorepo: firmware, the iOS app, shared protocol
definitions, backend services, evals, tooling, and docs all live together so a
single canonical locator/protocol contract can be shared across devices.

```
xteink/                     # repo root (project name: "Margin")
  firmware-x4/              # ESP32-S3 X4 Pro firmware (CrossPoint-derived fork)
    src/
      reader_integration/   # hooks into the reader engine
      locator/              # canonical locator engine
      playback_overlay/     # phrase-highlight partial-refresh overlay
      device_protocol/      # BLE/Wi-Fi protocol service
      annotations/          # highlight/note/selection UI + durable queue
    test_fixtures/          # EPUB + locator conformance fixtures
  ios/                      # SwiftUI companion app (requires macOS to build)
    MarginApp/
      DeviceBridge/         # BLE control + Wi-Fi bulk transfer
      Library/              # book metadata, content hashes, locator indexes
      Narration/            # TTS chunking, cache, playback queue
      Audio/                # AVAudioSession routing, ambient pause (VAD)
      Conversation/         # realtime voice agent + tools
      ReadingMemory/        # notes, transcripts, concept graph
      Sync/                 # bidirectional position/note sync
      UI/                   # Now Reading, Library, Notes, Ideas, Settings
    ShareExtension/         # send webpages/documents to the reading library
  shared/                   # cross-device contracts (source of truth)
    protocol/               # event schemas shared by firmware + iOS
    canonicalization/       # normalization rules + spec.md + fixtures
  services/                 # backend / cloud adapters
    auth-broker/            # ephemeral mobile credentials
    ai-adapters/            # TTS, realtime conversation, transcription, synthesis
  evals/                    # attribution, resume_accuracy, spoiler_boundary, ...
  tools/                    # reproducible setup + device scripts (this platform)
  docs/                     # architecture, protocol, privacy, recovery, setup
```

Directories not yet populated contain a `.gitkeep` and/or `README.md` describing
their future purpose. We build them out phase by phase per the roadmap.

## Getting started

Any computer can be brought up to speed with the tooling in `tools/`. See
[docs/setup.md](docs/setup.md) for the full, reproducible instructions.

Quick start (Windows / PowerShell):

```powershell
# From the repo root. Installs Python + esptool into a local virtualenv.
./tools/bootstrap.ps1

# Identify the connected X4 Pro (read-only, non-destructive).
./tools/identify-device.ps1

# Back up the entire factory flash BEFORE modifying anything.
./tools/backup-flash.ps1
```

## Safety first

The device is a production ESP32-S3 e-reader. **Do not write to its flash until
a verified full-flash backup exists.** The recovery procedure is documented in
[docs/recovery-x4.md](docs/recovery-x4.md).

## Platform notes

- **Firmware** (esptool now; **PlatformIO/pioarduino** for custom CrossPoint
  builds) works on Windows, macOS, or Linux.
- **iOS app** requires **macOS + Xcode**. It cannot be built on this Windows
  machine; that half of the monorepo is developed on a Mac.
