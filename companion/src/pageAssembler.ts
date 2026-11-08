// Decoding for the page-text characteristic (shared/protocol/ble.md).
// Pure JS on purpose: TextDecoder is not guaranteed on Hermes in RN 0.76, and
// atob is only a global (react-native does not export it).

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Map(Array.from(BASE64_ALPHABET, (char, index) => [char, index] as const));

export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let length = 0;

  for (const char of clean) {
    buffer = (buffer << 6) | (BASE64_LOOKUP.get(char) ?? 0);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[length++] = (buffer >> bits) & 0xff;
    }
  }

  return bytes.subarray(0, length);
}

// UTF-8 → string; malformed sequences become U+FFFD.
export function utf8Decode(bytes: Uint8Array): string {
  const codePoints: number[] = [];
  let index = 0;

  while (index < bytes.length) {
    const lead = bytes[index++];
    let needed = 0;
    let codePoint = lead;
    let min = 0;

    if (lead < 0x80) {
      codePoints.push(lead);
      continue;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      codePoint = lead & 0x1f;
      min = 0x80;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      codePoint = lead & 0x0f;
      min = 0x800;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      codePoint = lead & 0x07;
      min = 0x10000;
    } else {
      codePoints.push(0xfffd);
      continue;
    }

    let valid = true;
    for (let i = 0; i < needed; i++) {
      const next = bytes[index];
      if (next === undefined || (next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
      index++;
    }

    const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    codePoints.push(valid && codePoint >= min && codePoint <= 0x10ffff && !isSurrogate ? codePoint : 0xfffd);
  }

  let text = '';
  for (let i = 0; i < codePoints.length; i += 4096) {
    text += String.fromCodePoint(...codePoints.slice(i, i + 4096));
  }
  return text;
}

// Reassembles [seq][total][payload…] chunks into page text. Chunks of a page
// arrive in order; seq 0 always starts a new page. A gap (dropped notify) or a
// stray chunk discards the partial page rather than mixing pages together.
export class PageAssembler {
  private parts: Uint8Array[] = [];
  private total = 0;

  reset() {
    this.parts = [];
    this.total = 0;
  }

  // Returns the page text once its last chunk arrives, otherwise null.
  push(chunk: Uint8Array): string | null {
    if (chunk.length < 2) {
      return null;
    }

    const seq = chunk[0];
    const total = chunk[1];

    if (seq === 0) {
      this.reset();
      this.total = total;
    } else if (total !== this.total || seq !== this.parts.length) {
      this.reset();
      return null;
    }

    if (seq >= total) {
      this.reset();
      return null;
    }

    this.parts.push(chunk.slice(2));
    if (this.parts.length < this.total) {
      return null;
    }

    const size = this.parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of this.parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    this.reset();
    return utf8Decode(bytes);
  }
}
