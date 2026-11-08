// Pure text logic for narration (no React Native imports, so it can be unit-tested in Node).

const SENTENCE = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g;
const ENDS_SENTENCE = /[.!?…]["'”’)\]]*\s*$/;

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

/**
 * Splits off a trailing unfinished sentence: "A. B. And then" → { complete: "A. B.", remainder: "And then" }.
 * If the text has no sentence end at all, everything is "complete" (nothing to hold back).
 */
export function splitTrailingFragment(text: string): { complete: string; remainder: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || ENDS_SENTENCE.test(clean)) {
    return { complete: clean, remainder: '' };
  }
  const re = /[.!?…]["'”’)\]]*\s/g;
  let cut = -1;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    cut = m.index + m[0].length;
  }
  if (cut <= 0) {
    return { complete: clean, remainder: '' };
  }
  return { complete: clean.slice(0, cut).trim(), remainder: clean.slice(cut).trim() };
}

/**
 * Continuous reading: a sentence that runs over a page break is held back and spoken
 * with the next page, instead of stopping mid-sentence at the turn.
 */
export class PageBreakJoiner {
  private carry = '';
  private static readonly MAX_CARRY = 600;

  reset() {
    this.carry = '';
  }

  /** Text pending from the previous page (spoken on its own if no next page comes). */
  takeCarry(): string {
    const carry = this.carry;
    this.carry = '';
    return carry;
  }

  /**
   * Returns what to speak for this page. When `continuesPrevious` is false (e.g. the
   * reader jumped or turned back), any held fragment is dropped.
   */
  next(pageText: string, continuesPrevious: boolean): string {
    const joined = (continuesPrevious && this.carry ? `${this.carry} ${pageText}` : pageText).trim();
    const { complete, remainder } = splitTrailingFragment(joined);
    if (remainder.length > PageBreakJoiner.MAX_CARRY || !complete) {
      this.carry = '';
      return joined;
    }
    this.carry = remainder;
    return complete;
  }
}
