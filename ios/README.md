# ios — iPhone companion app (SwiftUI)

The invisible compute + audio brain. Expected to **fork/reuse CrossX**
([jtvargas/crosspoint-app](https://github.com/jtvargas/crosspoint-app), MIT — a
community app, not an official CrossPoint project) for device discovery, file
transfer, the EPUB pipeline, and the Share Extension. See
[../docs/forking.md](../docs/forking.md).

> **Requires macOS + Xcode 26 / iOS 26.** This half cannot be built on Windows or
> Linux. CrossX talks to the device over **HTTP/WiFi only (no BLE)** — Margin's
> BLE control channel, canonical locator, narration, audio, AI, and reading
> memory are all net-new. Architecture-review CrossX before deep coupling.

## Modules (spec §7)

| Module | Responsibility |
|--------|----------------|
| `MarginApp/DeviceBridge/` | BLE control channel + Wi-Fi bulk transfer, versioning. |
| `MarginApp/Library/` | Book metadata, content hashes, canonical text, locator index. |
| `MarginApp/Narration/` | TTS chunking, cache, prefetch, playback queue, phrase position. |
| `MarginApp/Audio/` | AVAudioSession routing (AirPods), duck/pause/resume. |
| `MarginApp/Conversation/` | Realtime voice agent on explicit intent; tool handlers. |
| `MarginApp/ReadingMemory/` | Highlights, notes, transcripts, concept graph, retrieval. |
| `MarginApp/Sync/` | Bidirectional position + note event sync. |
| `MarginApp/UI/` | Now Reading, Library, Notes, Ideas, Settings + cost meter. |
| `ShareExtension/` | Send webpages/documents to the reading library (reuse CrossX). |

## Contract

Consumes the shared canonical locator + protocol event schemas in
[../shared/](../shared/). Firmware and iOS must normalize text identically.
