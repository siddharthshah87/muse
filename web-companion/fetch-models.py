#!/usr/bin/env python3
"""Download the in-browser voice assets into web-companion/models/ (git-ignored).

  python3 web-companion/fetch-models.py

- ONNX Runtime Web 1.30.0 (MIT), served locally so its threaded workers are same-origin
- phonemizer 1.2.1 (eSpeak NG in WebAssembly; GPL-3.0 inside - fine for personal use,
  review before distributing)
- Kitten TTS v0.8 nano (int8), micro and mini (Apache-2.0, KittenML on Hugging Face);
  voices.npz is converted to voices.bin + voices.json so the browser needs no npz parser.

Standard library only. Safe to re-run: existing files are kept.
"""
import io
import json
import pathlib
import struct
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent / "models"
ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/"
PHONEMIZER = "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js"
KITTEN = {
    "nano-0.8-int8": ("KittenML/kitten-tts-nano-0.8-int8", "kitten_tts_nano_v0_8.onnx"),
    "micro-0.8": ("KittenML/kitten-tts-micro-0.8", "kitten_tts_micro_v0_8.onnx"),
    "mini-0.8": ("KittenML/kitten-tts-mini-0.8", "kitten_tts_mini_v0_8.onnx"),
}


def fetch(url: str, dest: pathlib.Path) -> None:
    if dest.exists() and dest.stat().st_size:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)


def npy_float32(data: bytes) -> tuple[tuple[int, ...], bytes]:
    """Shape and raw little-endian float32 payload of a .npy file (v1/v2 header)."""
    assert data[:6] == b"\x93NUMPY", "not a .npy file"
    major = data[6]
    hlen, start = (struct.unpack("<H", data[8:10])[0], 10) if major == 1 else (struct.unpack("<I", data[8:12])[0], 12)
    header = eval(data[start:start + hlen].decode("latin1"), {"__builtins__": {}})  # numpy's own dict literal
    assert header["descr"] in ("<f4", "|f4") and not header["fortran_order"], header
    return tuple(header["shape"]), data[start + hlen:]


def convert_voices(npz: pathlib.Path, config: dict, out: pathlib.Path) -> None:
    if (out / "voices.bin").exists() and (out / "voices.json").exists():
        return
    with zipfile.ZipFile(npz) as z:
        arrays = {n[:-4]: npy_float32(z.read(n)) for n in z.namelist() if n.endswith(".npy")}
    names = sorted(arrays)
    rows, dim = arrays[names[0]][0]
    (out / "voices.bin").write_bytes(b"".join(arrays[n][1] for n in names))
    (out / "voices.json").write_text(json.dumps({
        "names": names, "rows": rows, "dim": dim,
        "aliases": config.get("voice_aliases", {}), "speed_priors": config.get("speed_priors") or {},
    }))


def main() -> None:
    for name in ("ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"):
        fetch(ORT + name, ROOT / "ort" / name)
    fetch(PHONEMIZER, ROOT / "phonemizer" / "phonemizer.js")
    for model, (repo, onnx) in KITTEN.items():
        out = ROOT / "kitten" / model
        base = f"https://huggingface.co/{repo}/resolve/main/"
        fetch(base + onnx, out / "model.onnx")
        fetch(base + "voices.npz", out / "voices.npz")
        fetch(base + "config.json", out / "config.json")
        convert_voices(out / "voices.npz", json.loads((out / "config.json").read_text()), out)
    print(f"done: {ROOT}")


if __name__ == "__main__":
    main()
