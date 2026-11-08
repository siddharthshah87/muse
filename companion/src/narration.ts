// Pure text logic for narration (no React Native imports, so it can be unit-tested in Node).

const SENTENCE = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g;

// The X4 hyphenates at line ends and the page text keeps the split ("be- hind").
const LINE_HYPHEN = /([a-z])- (?=[a-z])/g;

/** Collapses whitespace and rejoins words the X4 split at a line-end hyphen. */
export function cleanForSpeech(text: string): string {
  return text.replace(/\s+/g, ' ').replace(LINE_HYPHEN, '$1').trim();
}

/** Splits text into sentence-sized pieces (≤ maxLen where possible) for queued speech. */
export function splitForSpeech(text: string, maxLen = 220): string[] {
  const sentences = cleanForSpeech(text).match(SENTENCE) ?? [];
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && (current + sentence).length > maxLen) {
      pieces.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) {
    pieces.push(current.trim());
  }
  return pieces;
}
