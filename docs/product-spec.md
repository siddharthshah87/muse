# Product spec

The authoritative product specification for Margin (X4 Pro AI Reading Companion).

- Source document (v0.1):
  [X4_Pro_AI_Reading_Companion_Product_Spec_v0.1.docx](X4_Pro_AI_Reading_Companion_Product_Spec_v0.1.docx)

The other docs in this folder derive from and operationalize that spec:

- [roadmap.md](roadmap.md) — phased delivery plan (§19, §27).
- [forking.md](forking.md) — how we fork CrossPoint (firmware) and CrossX (iOS).
- [hardware.md](hardware.md) — the ESP32-S3 device and how it presents to a host.
- [setup.md](setup.md) — reproducible toolchain setup on any machine.
- [recovery-x4.md](recovery-x4.md) — factory backup + restore (safety net).

## One-paragraph summary

Margin pairs the **X4 Pro** e-reader (visual reading, buttons, selection,
phrase highlighting) with an **iPhone** (TTS narration, AirPods audio, local
ambient-speech pause, explicit push-to-talk AI discussion, note/mind-map
synthesis, durable memory). Everything anchors to one **canonical locator**
(content hash + spine index + normalized character offsets) so reading,
narration, highlights, notes, and resume all point at the same stable position
regardless of font/page reflow. **BLE** carries low-latency control events;
**Wi-Fi** carries bulk transfers; audio stays on the phone. Privacy is a hard
boundary: ambient audio never leaves the phone, and only explicit push-to-talk
sends microphone audio to an AI service.

## Key invariants (do not violate)

1. Reading stays primary; no phone-style surfaces on the X4.
2. Intent before AI — ambient speech may pause playback but never starts an AI
   session or uploads mic audio.
3. One canonical position shared by every feature and both devices.
4. Preserve provenance — distinguish author text, user thoughts, and AI output.
5. Local-first where practical; cloud use is explicit, minimized, and cached.
