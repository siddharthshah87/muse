#!/usr/bin/env python3
"""Margin narration on a Linux computer: the X4 sends page text over Bluetooth,
this reads it aloud through the computer's speakers with a local neural voice.

A stand-in for the phone app (same protocol: shared/protocol/ble.md; same page
reassembly as companion/src/pageAssembler.ts). Nothing leaves the machine.

Modes:
  page        read each page, then wait for you to turn it (default)
  continuous  read the page to the end, turn it on the X4, keep going (needs
              X4 firmware with the control characteristic)

Dialogue gets per-character voices (male/female guessed from the text; see
tools/dialogue_voices.py); --no-dialogue-voices turns that off.

Usage:
  .venv/bin/python tools/nuc_companion.py [--mode page|continuous]
      [--voice af_heart] [--speed 0.95] [--no-dialogue-voices] [--list-voices]

Needs: .venv/bin/pip install bleak kokoro-onnx ; PulseAudio/PipeWire `paplay`.
The Kokoro model (8-bit, ~120 MB with voices, Apache-2.0) is downloaded to
~/.cache/margin/kokoro on first run. It runs at low priority on 3 threads; on a
busy machine expect pauses (it needs to generate faster than real time).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import pathlib
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from dialogue_voices import Cast, assign_voices  # noqa: E402

SERVICE = "4d555345-0001-1000-8000-000000000000"
PAGE_CHAR = "4d555345-0002-1000-8000-000000000000"
CONTROL_CHAR = "4d555345-0004-1000-8000-000000000000"
NEXT_PAGE = bytes([0x01])
NEXT_PAGE_WAIT_S = 15

MODEL_DIR = pathlib.Path.home() / ".cache" / "margin" / "kokoro"
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
FAST_MODEL = "kokoro-v1.0.int8.onnx"  # ~4x smaller, faster on CPU, slightly lower quality

# --- Text: same rules as companion/src/narration.ts ------------------------
SENTENCE = re.compile(r"[^.!?…]+(?:[.!?…]+[\"'”’)\]]*|$)\s*")
ENDS_SENTENCE = re.compile(r"[.!?…][\"'”’)\]]*\s*$")
SENTENCE_BREAK = re.compile(r"[.!?…][\"'”’)\]]*\s")


# The X4 hyphenates at line ends and the page text keeps the split ("be- hind").
LINE_HYPHEN = re.compile(r"(?<=[a-z])- (?=[a-z])")


def clean_for_speech(text: str) -> str:
    return LINE_HYPHEN.sub("", re.sub(r"\s+", " ", text)).strip()


def split_for_speech(text: str, max_len: int = 220) -> list[str]:
    pieces, cur = [], ""
    for s in SENTENCE.findall(clean_for_speech(text)):
        if cur and len(cur + s) > max_len:
            pieces.append(cur.strip())
            cur = ""
        cur += s
    if cur.strip():
        pieces.append(cur.strip())
    return pieces


def quick_start(pieces: list[str], first_max: int = 90) -> list[str]:
    """Shortens the first piece (at a comma or semicolon) so speech starts sooner;
    later pieces are synthesized while earlier ones play."""
    if not pieces or len(pieces[0]) <= first_max:
        return pieces
    head = pieces[0]
    cut = max(head.rfind(", ", 30, first_max), head.rfind("; ", 30, first_max))
    if cut < 0:
        first_sentence = SENTENCE.match(head)
        cut = first_sentence.end() - 1 if first_sentence and 30 <= first_sentence.end() < len(head) else -1
    if cut < 0:
        return pieces
    return [head[: cut + 1].strip(), head[cut + 1 :].strip()] + pieces[1:]


def split_trailing_fragment(text: str) -> tuple[str, str]:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean or ENDS_SENTENCE.search(clean):
        return clean, ""
    cuts = [m.end() for m in SENTENCE_BREAK.finditer(clean)]
    if not cuts:
        return clean, ""
    return clean[: cuts[-1]].strip(), clean[cuts[-1]:].strip()


class PageBreakJoiner:
    MAX_CARRY = 600

    def __init__(self) -> None:
        self.carry = ""

    def take_carry(self) -> str:
        carry, self.carry = self.carry, ""
        return carry

    def next(self, page: str, continues_previous: bool) -> str:
        joined = (f"{self.carry} {page}" if continues_previous and self.carry else page).strip()
        complete, remainder = split_trailing_fragment(joined)
        if len(remainder) > self.MAX_CARRY or not complete:
            self.carry = ""
            return joined
        self.carry = remainder
        return complete


class PageAssembler:
    def __init__(self) -> None:
        self.parts: list[bytes] = []
        self.total = 0
        self.discarded = 0

    def push(self, data: bytes) -> str | None:
        if len(data) < 2:
            return None
        seq, total, payload = data[0], data[1], data[2:]
        if seq == 0:
            self.parts, self.total = [], total
        elif seq != len(self.parts) or total != self.total:
            if self.parts:
                self.discarded += 1
                print("  ! missed a chunk; partial page dropped", flush=True)
            self.parts, self.total = [], 0
            return None
        if seq >= total:
            self.parts, self.total = [], 0
            return None
        self.parts.append(payload)
        if len(self.parts) < self.total:
            return None
        raw = b"".join(self.parts)
        self.parts, self.total = [], 0
        return raw.decode("utf-8", "replace")


# --- Speech ------------------------------------------------------------------
def ensure_model(model: str) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for name in (model, MODEL_FILES[1]):
        path = MODEL_DIR / name
        if path.exists() and path.stat().st_size > 0:
            continue
        print(f"Downloading {name} to {MODEL_DIR} (one time)...", flush=True)
        tmp = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(MODEL_URL + name, tmp)
        tmp.rename(path)


class Speaker:
    """Kokoro synthesis a sentence at a time, streamed to paplay. speak() interrupts."""

    def __init__(self, voice: str, speed: float, pause: float, dialogue: bool = True,
                 model: str = FAST_MODEL, threads: int = 3) -> None:
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        # Bounded threads so narration doesn't starve everything else on the machine.
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        session = ort.InferenceSession(str(MODEL_DIR / model), opts, providers=["CPUExecutionProvider"])
        self.kokoro = Kokoro.from_session(session, str(MODEL_DIR / MODEL_FILES[1]))
        if voice not in self.kokoro.get_voices():
            raise SystemExit(f"Unknown voice {voice!r}. See --list-voices.")
        self.voice, self.speed, self.pause = voice, speed, pause
        # Characters keep their voices for the whole session (one book at a time).
        self.cast = Cast(narrator=voice) if dialogue else None
        self.rate = 24000
        self.gen = 0
        self.proc: subprocess.Popen | None = None
        self.lock = threading.Lock()

    def stop(self) -> int:
        with self.lock:
            self.gen += 1
            if self.proc and self.proc.poll() is None:
                self.proc.kill()
            self.proc = None
            return self.gen

    def speak(self, text: str, on_done=None) -> None:
        gen = self.stop()
        threading.Thread(target=self._run, args=(gen, text, on_done), daemon=True).start()

    def _run(self, gen: int, text: str, on_done) -> None:
        import numpy as np

        if self.cast:
            pieces = [(p, v) for seg, v in assign_voices(text, self.cast) for p in split_for_speech(seg)]
        else:
            pieces = [(p, self.voice) for p in split_for_speech(text)]
        if pieces:  # shorten only the opening piece so speech starts sooner
            head = quick_start([pieces[0][0]])
            pieces = [(h, pieces[0][1]) for h in head] + pieces[1:]
        proc = subprocess.Popen(
            ["paplay", "--raw", f"--rate={self.rate}", "--format=s16le", "--channels=1"],
            stdin=subprocess.PIPE,
        )
        with self.lock:
            if gen != self.gen:
                proc.kill()
                return
            self.proc = proc
        gap = b"\x00\x00" * int(self.rate * self.pause)
        # Synthesize ahead on its own thread (Kokoro runs faster than real time here), so
        # playback never waits for the next sentence; this thread only feeds paplay.
        ready: queue.Queue = queue.Queue()

        def produce() -> None:
            for piece, voice in pieces:
                if gen != self.gen:
                    break
                samples, _ = self.kokoro.create(piece, voice=voice, speed=self.speed, lang="en-us")
                ready.put((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
            ready.put(None)

        threading.Thread(target=produce, daemon=True).start()
        try:
            while True:
                pcm = ready.get()
                if pcm is None or gen != self.gen:
                    break
                proc.stdin.write(pcm + gap)
                proc.stdin.flush()
            if gen != self.gen:
                return
            proc.stdin.close()
            proc.wait()  # returns when the last sample has played
        except (BrokenPipeError, ValueError, OSError):
            return  # interrupted by a newer page
        if gen == self.gen and on_done:
            on_done()


# --- Bluetooth ---------------------------------------------------------------
def drop_stale_connection() -> None:
    """BlueZ can keep a dead client's link open, and the X4 stops advertising while connected."""
    try:
        out = subprocess.run(["bluetoothctl", "devices", "Connected"], capture_output=True, text=True, timeout=5).stdout
        for line in out.splitlines():
            parts = line.split(" ", 2)
            if len(parts) == 3 and parts[2].strip() == "Margin":
                subprocess.run(["bluetoothctl", "disconnect", parts[1]], capture_output=True, timeout=5)
                print(f"Dropped a leftover connection to {parts[1]}", flush=True)
    except (OSError, subprocess.SubprocessError):
        pass


async def session(args, speaker: Speaker | None) -> None:
    from bleak import BleakClient, BleakScanner

    drop_stale_connection()
    print("Looking for Margin (open a book on the X4 and turn a page)...", flush=True)
    dev = None
    while dev is None:
        dev = await BleakScanner.find_device_by_filter(
            lambda d, ad: SERVICE in [u.lower() for u in ad.service_uuids] or (d.name or "") == "Margin",
            timeout=10,
        )
    loop = asyncio.get_running_loop()
    assembler, joiner = PageAssembler(), PageBreakJoiner()
    state = {"awaiting": False, "pages": 0, "wait": None, "asked_at": 0.0}

    async with BleakClient(dev) as client:
        chars = {c.uuid.lower() for s in client.services for c in s.characteristics}
        can_turn = CONTROL_CHAR in chars
        mode = args.mode
        if mode == "continuous" and not can_turn:
            print("This X4 firmware can't turn pages on request; reading page by page.", flush=True)
            mode = "page"
        print(f"Connected to {dev.address}. Mode: {mode}. Turn a page on the X4.", flush=True)

        def cancel_wait():
            if state["wait"]:
                state["wait"].cancel()
                state["wait"] = None

        async def request_next():
            if not client.is_connected:
                return
            cancel_wait()
            state["awaiting"] = True
            state["asked_at"] = time.monotonic()
            print("  → turning the page", flush=True)

            def no_page():
                state["awaiting"] = False
                carry = joiner.take_carry()
                print("  (no new page: end of book, or the X4 is busy)", flush=True)
                if carry and speaker:
                    speaker.speak(carry)

            state["wait"] = loop.call_later(NEXT_PAGE_WAIT_S, no_page)
            try:
                await client.write_gatt_char(CONTROL_CHAR, NEXT_PAGE, response=False)
            except Exception as e:  # noqa: BLE001 — report and keep listening
                print(f"  ! page-turn request failed: {e}", flush=True)

        def after_page():  # called from the speech thread
            if mode == "continuous":
                asyncio.run_coroutine_threadsafe(request_next(), loop)

        def on_page(text: str) -> None:
            if not text.strip():
                print("  (page without text)", flush=True)
                if mode == "continuous":
                    loop.call_later(0.4, lambda: asyncio.ensure_future(request_next()))
                return
            continues = state["awaiting"]
            state["awaiting"] = False
            cancel_wait()
            state["pages"] += 1
            print(f"\n— page {state['pages']} —\n{text}\n", flush=True)
            if state["asked_at"]:
                print(f"  (page arrived {time.monotonic() - state['asked_at']:.1f}s after the turn request)", flush=True)
                state["asked_at"] = 0.0
            if speaker:
                # Read to the end of the page, then turn: the X4 never shows a page ahead of the voice.
                speaker.speak(text, after_page if mode == "continuous" else None)

        def on_notify(_, data: bytearray) -> None:
            text = assembler.push(bytes(data))
            if text is not None:
                on_page(text)

        await client.start_notify(PAGE_CHAR, on_notify)
        while client.is_connected:
            await asyncio.sleep(0.5)
        cancel_wait()
    print("Disconnected (the X4 went to sleep or left the book).", flush=True)


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["page", "continuous"], default="page")
    ap.add_argument("--voice", default="af_heart", help="Kokoro voice, e.g. af_heart, am_michael, bf_emma")
    ap.add_argument("--speed", type=float, default=0.95, help="1.0 is normal; lower is slower")
    ap.add_argument("--pause", type=float, default=0.25, help="seconds of silence between sentences")
    ap.add_argument("--no-speak", action="store_true", help="print pages only")
    ap.add_argument("--no-dialogue-voices", action="store_true",
                    help="read dialogue in the narrator's voice instead of per-character voices")
    ap.add_argument("--list-voices", action="store_true")
    ap.add_argument("--full-model", action="store_true",
                    help="full-precision Kokoro: a little better, ~25%% slower (default: 8-bit)")
    ap.add_argument("--threads", type=int, default=3, help="CPU threads for the voice model")
    args = ap.parse_args()

    try:
        import bleak  # noqa: F401
        import kokoro_onnx  # noqa: F401
    except ImportError as e:
        print(f"Missing {e.name}. Install with:  .venv/bin/pip install bleak kokoro-onnx", file=sys.stderr)
        return 1

    try:
        os.nice(10)  # narration should yield to interactive work on a shared machine
    except OSError:
        pass
    model = MODEL_FILES[0] if args.full_model else FAST_MODEL
    speaker = None
    if not args.no_speak or args.list_voices:
        ensure_model(model)
        print(f"Loading voice {args.voice} ({'full' if args.full_model else '8-bit'} model)...", flush=True)
        speaker = Speaker(args.voice, args.speed, args.pause, dialogue=not args.no_dialogue_voices,
                          model=model, threads=args.threads)
        if args.list_voices:
            print("\n".join(sorted(speaker.kokoro.get_voices())))
            return 0
        speaker.speak("Margin is ready.")

    while True:  # reconnect whenever the X4 sleeps or restarts
        try:
            await session(args, speaker)
        except Exception as e:  # noqa: BLE001 — Bluetooth errors are transient; retry
            print(f"Bluetooth error: {e}. Retrying...", flush=True)
        if speaker:
            speaker.stop()
        await asyncio.sleep(3)


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        pass
