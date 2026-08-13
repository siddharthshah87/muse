# Roadmap — phased delivery

Condensed from the product spec (§19, §27). The guiding rule: **prove the
cross-device interaction before investing in mind maps or polished UI**, and
**own the device safely before modifying it**.

## Phase 0 — Hardware proof (current)

Goal: safely own the device stack.

- [x] Detect device on host (ESP32-S3, native USB, COM/tty).
- [x] Cross-platform toolchain bootstrap (`tools/bootstrap.sh` + Python).
- [x] Read-only chip identify (`tools/identify_device.py`).
- [x] **Full factory flash backup** (16 MB, checksum-verified) + restore procedure.
- [ ] Custom X4 Pro fork boots (displays a version string, reflashable).
      Build CrossPoint with an **`x4pro` env** (model on `[env:sticky]` +
      freeink-sdk's sample `[env:x4pro]`, `-DFREEINK_DEVICE_X4PRO=1`); flash to
      **app0 @ 0x10000** and point `otadata` at app0 (OEM stays in app1).
- [ ] Confirm touch / buttons / display / front-light / Wi-Fi / BLE feasibility.
      Most peripherals are already confirmed in freeink-sdk; **BLE is the gap**
      (disabled in mainline via `lib_ignore = BLE`).

Exit: factory flash backed up and restorable; a custom "Hello" build boots.

## Phase 1 — Read/listen loop

Prove synchronized narration between X4 and iPhone.

- Open a known EPUB on X4; expose current canonical locator.
- iPhone narrates the current paragraph; X4 highlights the active phrase.
- Pause/resume and manual page change work.

## Phase 2 — Discuss loop

Prove natural interruption-to-agent flow.

- Hold Talk → narration pauses → realtime discussion gets the exact passage →
  Continue resumes the correct position.

## Phase 3 — Reading memory

Highlights, typed/voice notes, transcripts, extracted insight, and session
review persist with provenance.

## Phase 4 — Mind map

iPhone knowledge graph; X4 local branch; Author/User/AI distinctions;
"show source" navigation.

## Phase 5 — Seamless mobility

Walk mode, offline cached audio, reconnect and visual resume from audio position.

## Phase 6 — Cross-book intelligence

Search prior reading memory; cross-book connections; Kindle highlight import;
Socratic/challenge modes.

## First build sequence (within Phase 0→1)

1. Device recovery baseline (backup + tested restore).
2. Custom X4 fork boots (version string, reflashable).
3. Locator proof (stable book/spine/offset for a paragraph).
4. Phone bridge (iPhone receives locator/button events).
5. Narration proof (phone speaks current paragraph).
6. Highlight proof (X4 highlight follows playback).
7. Push-to-talk proof (hold pauses narration, records only held speech).
8. Agent proof (grounded discussion + resume).
