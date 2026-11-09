// Kitten TTS v0.8 in the browser, off the main thread.
// Same pipeline as KittenML's Python package: eSpeak phonemes (punctuation kept) → symbol ids →
// style row picked by input length → one ONNX call per piece of text.
//
// Messages in:
//   {type:'load', model}
//   {type:'synth', id, pieces:[{text, voice}], rate}   queued; jobs run one at a time, in order
//   {type:'cancel', id}                           drop a queued job / stop a running one
//   {type:'run', text, voice}                     kitten-test.html: one job, sentence by sentence
// Messages out:
//   {type:'loaded', secs, threads}
//   {type:'chunk', id, index, samples, rate, at}  one per piece, in order
//   {type:'done', id, secs}  |  {type:'cancelled', id}
//   {type:'error', where, id?, message}
import * as ort from "./models/ort/ort.wasm.min.mjs";
import { phonemize } from "./models/phonemizer/phonemizer.js";

ort.env.wasm.wasmPaths = new URL("./models/ort/", self.location.href).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 4) : 1;

const SYMBOLS = [..."$;:,.!?¡¿—…\"«»\"\" ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ"];
const INDEX = new Map(SYMBOLS.map((s, i) => [s, i]));
const PUNCT = /([;:,.!?¡¿—…"«»“”()]+)/;
const RATE = 24000;

let session = null, voices = null, meta = null;
const queue = [];          // pending jobs
const cancelled = new Set();
let running = false;

async function phonemesKeepingPunctuation(text) {
  let out = "";
  for (const part of text.split(PUNCT)) {
    if (!part.trim()) { out += part; continue; }
    if (PUNCT.test(part) && part.replace(PUNCT, "") === "") { out += part; continue; }
    out += (await phonemize(part, "en-us")).join(" ");
  }
  // Python reference: " ".join(re.findall(r"\w+|[^\w\s]", phonemes))
  return (out.match(/[\p{L}\p{M}\p{N}_]+|[^\p{L}\p{M}\p{N}_\s]/gu) || []).join(" ");
}

async function synthesize(text, voiceName, rate = 1) {
  const voice = meta.aliases[voiceName] || voiceName;
  const v = Math.max(0, meta.names.indexOf(voice));
  const speed = (meta.speed_priors[voice] || 1.0) * rate;
  const tokens = [0];
  for (const ch of await phonemesKeepingPunctuation(text)) if (INDEX.has(ch)) tokens.push(INDEX.get(ch));
  tokens.push(0);
  const row = Math.min(tokens.length, meta.rows - 1);
  const start = (v * meta.rows + row) * meta.dim;
  const result = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]),
    style: new ort.Tensor("float32", voices.slice(start, start + meta.dim), [1, meta.dim]),
    speed: new ort.Tensor("float32", new Float32Array([speed]), [1]),
  });
  return new Float32Array(result[session.outputNames[0]].data);
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    if (cancelled.has(job.id)) { cancelled.delete(job.id); self.postMessage({ type: "cancelled", id: job.id }); continue; }
    const t0 = performance.now();
    try {
      for (let i = 0; i < job.pieces.length; i++) {
        if (cancelled.has(job.id)) break;
        const samples = await synthesize(job.pieces[i].text, job.pieces[i].voice, job.rate || 1);
        self.postMessage({ type: "chunk", id: job.id, index: i, samples, rate: RATE, at: (performance.now() - t0) / 1000 },
          [samples.buffer]);
      }
      if (cancelled.has(job.id)) { cancelled.delete(job.id); self.postMessage({ type: "cancelled", id: job.id }); }
      else self.postMessage({ type: "done", id: job.id, secs: (performance.now() - t0) / 1000 });
    } catch (e) {
      self.postMessage({ type: "error", where: "synth", id: job.id, message: String(e && (e.stack || e.message) || e) });
    }
  }
  running = false;
}

self.onmessage = async ({ data }) => {
  if (data.type === "load") {
    const t0 = performance.now();
    try {
      const base = `./models/kitten/${data.model}/`;
      meta = await (await fetch(base + "voices.json")).json();
      voices = new Float32Array(await (await fetch(base + "voices.bin")).arrayBuffer());
      session = await ort.InferenceSession.create(base + "model.onnx", { executionProviders: ["wasm"] });
      await phonemesKeepingPunctuation("Warm up."); // loads eSpeak
      self.postMessage({ type: "loaded", secs: (performance.now() - t0) / 1000, threads: ort.env.wasm.numThreads });
    } catch (e) {
      self.postMessage({ type: "error", where: "load", message: String(e && (e.stack || e.message) || e) });
    }
  } else if (data.type === "synth") {
    queue.push({ id: data.id, pieces: data.pieces, rate: data.rate || 1 });
    void pump();
  } else if (data.type === "cancel") {
    if (queue.some((j) => j.id === data.id) || running) cancelled.add(data.id);
  } else if (data.type === "run") {
    // kitten-test.html: one passage, split into sentences
    const sentences = data.text.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) || [data.text];
    queue.push({ id: "test", pieces: sentences.map((s) => ({ text: s.trim(), voice: data.voice })) });
    void pump();
  }
};
