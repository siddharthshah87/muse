#!/usr/bin/env python3
"""Margin narration on a Linux computer: the X4 sends page text over Bluetooth,
this reads it aloud through the computer's speakers with a local neural voice.

A stand-in for the phone app (same protocol: shared/protocol/ble.md; same page
reassembly as companion/src/pageAssembler.ts). Nothing leaves the machine.

Modes:
  page        read each page, then wait for you to turn it (default)
  continuous  read the page to the end, turn it on the X4, keep going (needs
              X4 firmware with the control characteristic). With firmware that
              answers PEEK_NEXT, the next page is prepared while the current
              one is read, so the turn and the next page start together.

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
PEEK_NEXT = bytes([0x02])
PREVIEW_FLAG = 0x80  # set on seq for next-page previews (shared/protocol/ble.md)
NEXT_PAGE_WAIT_S = 15

MODEL_DIR = pathlib.Path.home() / ".cache" / "margin" / "kokoro"
MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
FAST_MODEL = "kokoro-v1.0.int8.onnx"  # ~4x smaller, faster on CPU, slightly lower quality

# --- Text: same rules as companion/src/narration.ts ------------------------
SENTENCE = re.compile(r"[^.!?…]+(?:[.!?…]+[\"'”’)\]]*|$)\s*")


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


class Prepared:
    """A page's audio, synthesized sentence by sentence on a background thread."""

    def __init__(self, text: str, pieces: list[tuple[str, str]]) -> None:
        self.text = text
        self.pieces = pieces
        self.ready: queue.Queue = queue.Queue()
        self.cancelled = False
        self.synth_done = threading.Event()

    def cancel(self) -> None:
        self.cancelled = True


class Speaker:
    """Kokoro synthesis a sentence at a time, streamed to paplay.

    prepare() starts synthesizing a page without playing it (the next page, while the
    current one plays); play() plays a prepared page and interrupts whatever was playing.
    """

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

    def _pieces(self, text: str) -> list[tuple[str, str]]:
        if self.cast:
            pieces = [(p, v) for seg, v in assign_voices(text, self.cast) for p in split_for_speech(seg)]
        else:
            pieces = [(p, self.voice) for p in split_for_speech(text)]
        if pieces:  # shorten only the opening piece so speech starts sooner
            head = quick_start([pieces[0][0]])
            pieces = [(h, pieces[0][1]) for h in head] + pieces[1:]
        return pieces

    def prepare(self, text: str, after: Prepared | None = None) -> Prepared:
        """Start synthesizing text. With `after`, wait until that page is fully synthesized
        first, so the page being heard never competes with the one being prepared."""
        import numpy as np

        prep = Prepared(text, self._pieces(text))

        def produce() -> None:
            try:
                if after is not None:
                    after.synth_done.wait()
                for piece, voice in prep.pieces:
                    if prep.cancelled:
                        break
                    samples, _ = self.kokoro.create(piece, voice=voice, speed=self.speed, lang="en-us")
                    prep.ready.put((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
            finally:
                prep.ready.put(None)
                prep.synth_done.set()

        threading.Thread(target=produce, daemon=True).start()
        return prep

    def stop(self) -> int:
        with self.lock:
            self.gen += 1
            if self.proc and self.proc.poll() is None:
                self.proc.kill()
            self.proc = None
            return self.gen

    def play(self, prep: Prepared, on_done=None) -> None:
        gen = self.stop()
        threading.Thread(target=self._play, args=(gen, prep, on_done), daemon=True).start()

    def speak(self, text: str, on_done=None) -> None:
        self.play(self.prepare(text), on_done)

    def _play(self, gen: int, prep: Prepared, on_done) -> None:
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
        try:
            while True:
                pcm = prep.ready.get()
                if pcm is None or gen != self.gen:
                    break
                proc.stdin.write(pcm + gap)
                proc.stdin.flush()
            if gen != self.gen:
                prep.cancel()
                return
            proc.stdin.close()
            proc.wait()  # returns when the last sample has played
        except (BrokenPipeError, ValueError, OSError):
            prep.cancel()
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
    pages_asm, preview_asm = PageAssembler(), PageAssembler()
    state = {
        "pages": 0, "wait": None, "asked_at": 0.0,
        "current": None,        # Prepared page being heard
        "next": None,           # Prepared preview of the following page
        "confirm": None,        # text we already started at the turn; the real page should match it
        "peek_ok": None,        # None = unknown, True/False once we know if the firmware answers PEEK_NEXT
        "peek_timer": None,
    }

    async with BleakClient(dev) as client:
        chars = {c.uuid.lower() for s in client.services for c in s.characteristics}
        mode = args.mode
        if mode == "continuous" and CONTROL_CHAR not in chars:
            print("This X4 firmware can't turn pages on request; reading page by page.", flush=True)
            mode = "page"
        print(f"Connected to {dev.address}. Mode: {mode}. Turn a page on the X4.", flush=True)

        def cancel_timer(key):
            if state[key]:
                state[key].cancel()
                state[key] = None

        async def write(cmd: bytes, what: str) -> None:
            try:
                await client.write_gatt_char(CONTROL_CHAR, cmd, response=False)
            except Exception as e:  # noqa: BLE001 — report and keep listening
                print(f"  ! {what} request failed: {e}", flush=True)

        async def request_peek():
            if mode != "continuous" or state["peek_ok"] is False or not client.is_connected:
                return

            def no_preview():
                state["peek_timer"] = None
                if state["peek_ok"] is None:
                    state["peek_ok"] = False
                    print("  (this X4 firmware has no page previews; turning first, then reading)", flush=True)

            if state["peek_ok"] is None and state["peek_timer"] is None:
                state["peek_timer"] = loop.call_later(2.5, no_preview)  # first unanswered request decides
            await write(PEEK_NEXT, "preview")

        async def request_turn():
            if not client.is_connected:
                return
            cancel_timer("wait")
            state["asked_at"] = time.monotonic()

            def no_page():
                state["wait"] = None
                state["confirm"] = None
                print("  (no new page: end of book, or the X4 is busy)", flush=True)

            state["wait"] = loop.call_later(NEXT_PAGE_WAIT_S, no_page)
            await write(NEXT_PAGE, "page-turn")

        def after_page():  # called from the speech thread when a page has been read to the end
            if mode != "continuous":
                return

            def advance():
                nxt = state["next"]
                state["next"] = None
                if nxt is not None:
                    # Gapless: turn and start the prepared next page together.
                    print("  → turning the page (next page already prepared)", flush=True)
                    state["current"], state["confirm"] = nxt, nxt.text
                    speaker.play(nxt, after_page)
                else:
                    print("  → turning the page", flush=True)
                asyncio.ensure_future(request_turn())

            loop.call_soon_threadsafe(advance)

        def on_page(text: str) -> None:
            cancel_timer("wait")
            if state["asked_at"]:
                print(f"  (X4 turned and sent the page {time.monotonic() - state['asked_at']:.1f}s after the request)", flush=True)
                state["asked_at"] = 0.0
            if state["confirm"] is not None and text == state["confirm"]:
                state["confirm"] = None  # already being read since the turn
                asyncio.ensure_future(request_peek())
                return
            state["confirm"] = None
            if not text.strip():
                print("  (page without text)", flush=True)
                if mode == "continuous":
                    loop.call_later(0.4, lambda: asyncio.ensure_future(request_turn()))
                return
            state["pages"] += 1
            print(f"\n— page {state['pages']} —\n{text}\n", flush=True)
            if state["next"] is not None:  # the reader moved somewhere else: drop the stale preview
                state["next"].cancel()
                state["next"] = None
            if speaker:
                state["current"] = speaker.prepare(text)
                speaker.play(state["current"], after_page if mode == "continuous" else None)
            asyncio.ensure_future(request_peek())

        def on_preview(text: str) -> None:
            cancel_timer("peek_timer")
            state["peek_ok"] = True
            if state["next"] is not None:
                state["next"].cancel()
            if text.strip() and speaker:
                state["next"] = speaker.prepare(text, after=state["current"])
            else:
                state["next"] = None  # next page not laid out yet, or has no text: turn first

        def on_notify(_, data: bytearray) -> None:
            raw = bytes(data)
            if raw and raw[0] & PREVIEW_FLAG:
                text = preview_asm.push(bytes([raw[0] & ~PREVIEW_FLAG & 0xFF]) + raw[1:])
                if text is not None:
                    on_preview(text)
                return
            text = pages_asm.push(raw)
            if text is not None:
                on_page(text)

        await client.start_notify(PAGE_CHAR, on_notify)
        while client.is_connected:
            await asyncio.sleep(0.5)
        cancel_timer("wait")
        cancel_timer("peek_timer")
        if state["next"] is not None:
            state["next"].cancel()
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
