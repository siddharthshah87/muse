// Give dialogue its own voices: find quoted speech, guess who says it and their gender, and give
// each character a consistent voice distinct from the narrator. JavaScript port of
// tools/dialogue_voices.py (keep the two in step). Heuristics only; the narrator voice is the
// fallback when it can't tell.
(function (global) {
  "use strict";
  const VERBS =
    "said|says|say|asked|asks|replied|replies|answered|answers|whispered|whispers|shouted|shouts|" +
    "yelled|called|cried|muttered|murmured|added|continued|began|told|tells|snapped|exclaimed|" +
    "insisted|explained|laughed|sighed|repeated|demanded|admitted|agreed|warned|offered|pleaded|" +
    "protested|suggested|announced|declared|observed|remarked|retorted|interrupted|breathed|growled";
  const NAME = "(?:(?:Mr|Mrs|Ms|Miss|Dr|Sir|Lady|Lord|Uncle|Aunt|Captain|Professor)\\.? )?[A-Z][a-z]+(?: [A-Z][a-z]+)?";
  const WHO = `\\b((?:[Hh]e|[Ss]he)|${NAME})`;
  // "…,” Marlow said / she asked   and   “…,” said Marlow
  const AFTER = new RegExp(`^\\s*(?:${WHO}\\s+(?:${VERBS})\\b|(?:${VERBS})\\s+${WHO}\\b)`);
  // Marlow said, “…   /   She leaned out of the booth and said: “…
  const BEFORE = new RegExp(`${WHO}\\s+(?:[^.!?“”"\\s]+\\s+){0,10}?(?:${VERBS})\\b[^.!?“”"]{0,40}[,:]?\\s*$`);
  const NAME_RE = new RegExp(`\\b${NAME}\\b`, "g");
  const LEARN = new RegExp(`\\b(${NAME})\\b[^.!?“”"]{1,80}?\\b(he|his|him|himself|she|her|hers|herself)\\b`);

  const FEMALE_TITLES = new Set(["mrs", "ms", "miss", "lady", "aunt", "queen", "madam", "sister", "mother"]);
  const MALE_TITLES = new Set(["mr", "sir", "lord", "uncle", "king", "father", "brother"]);
  const NOT_NAMES = new Set(["The", "A", "An", "But", "And", "Then", "When", "If", "It", "He", "She", "They", "We",
    "I", "You", "His", "Her", "Their", "This", "That", "There", "What", "Why", "How", "Yes", "No", "Oh", "Well"]);
  // A small seed list; the book's own pronoun use refines and overrides it.
  const FEMALE_NAMES = new Set(("mary anna emma elizabeth sarah jane margaret susan alice catherine kate katherine " +
    "grace lucy charlotte emily olivia sophia sophie isabella mia amelia ava ella chloe hannah laura julia rose helen " +
    "ruth anne annie clara eleanor ellen frances martha nancy rebecca rachel linda karen lisa jennifer jessica amy " +
    "maria elena eva claire diana dorothy jean joan judith marie natalie nina nora paula sandra sylvia teresa " +
    "victoria wendy zoe beth daisy esther harriet irene lily louise lydia mabel maggie marian matilda molly polly " +
    "rosie stella violet hermione ginny luna petunia").split(" "));
  const MALE_NAMES = new Set(("john james robert michael william david richard joseph thomas charles christopher " +
    "daniel matthew george henry edward peter paul mark steven andrew kenneth joshua kevin brian timothy ronald " +
    "jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott frank brandon benjamin samuel " +
    "gregory alexander patrick jack dennis jerry tyler aaron adam nathan harry arthur albert alfred fred frederick " +
    "hugh ian leo louis max oliver oscar ralph roger simon tom tony victor walter will bill bob jim joe mike nick " +
    "sam ben dan ted ron hagrid draco neville sirius remus severus marlow holmes watson").split(" "));

  // Kitten TTS v0.8 voices.
  const FEMALE_VOICES = ["Bella", "Luna", "Rosie", "Kiki"];
  const MALE_VOICES = ["Jasper", "Bruno", "Hugo", "Leo"];

  function firstName(name) {
    const parts = name.replace(/\./g, "").split(/\s+/);
    const title = parts[0].toLowerCase();
    return parts.length > 1 && (FEMALE_TITLES.has(title) || MALE_TITLES.has(title)) ? parts[1] : parts[0];
  }

  class Cast {
    constructor(narrator) {
      this.narrator = narrator;
      this.femalePool = FEMALE_VOICES.filter((v) => v !== narrator);
      this.malePool = MALE_VOICES.filter((v) => v !== narrator);
      this.votes = new Map(); // first name -> {m, f}
      this.voices = new Map(); // speaker key -> voice
      this.recent = []; // speaker keys, newest last
    }

    // What to remember per book: who is male/female and who has which voice.
    toJSON() {
      return { narrator: this.narrator, votes: [...this.votes], voices: [...this.voices] };
    }

    static fromJSON(saved, narrator) {
      const cast = new Cast(narrator);
      cast.votes = new Map(saved.votes || []);
      // Keep characters' voices unless the narrator changed (a character might now share it).
      if (saved.narrator === narrator) cast.voices = new Map(saved.voices || []);
      return cast;
    }

    learn(text) {
      for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
        const m = sentence.match(LEARN);
        if (m && !NOT_NAMES.has(m[1].split(" ")[0])) {
          const key = firstName(m[1]);
          const v = this.votes.get(key) || { m: 0, f: 0 };
          if (/^(she|her)/i.test(m[2])) v.f++; else v.m++;
          this.votes.set(key, v);
        }
      }
    }

    gender(who) {
      const w = who.toLowerCase();
      if (w === "he") return "m";
      if (w === "she") return "f";
      const title = w.replace(/\./g, "").split(/\s+/)[0];
      if (FEMALE_TITLES.has(title)) return "f";
      if (MALE_TITLES.has(title)) return "m";
      const first = firstName(who);
      const v = this.votes.get(first);
      if (v && v.m !== v.f) return v.m > v.f ? "m" : "f";
      if (FEMALE_NAMES.has(first.toLowerCase())) return "f";
      if (MALE_NAMES.has(first.toLowerCase())) return "m";
      return null;
    }

    voiceForName(key, gender) {
      if (!this.voices.has(key)) {
        const pool = gender === "f" ? this.femalePool : gender === "m" ? this.malePool : [];
        const used = new Set(this.voices.values());
        const free = pool.filter((v) => !used.has(v));
        this.voices.set(key, (free.length ? free : pool)[0] || this.narrator);
      }
      return this.voices.get(key);
    }

    speakerVoice(who, mentions) {
      if (who === null) {
        // Unattributed: alternate with the previous speaker in this exchange.
        if (this.recent.length >= 2) {
          const key = this.recent[this.recent.length - 2];
          this.recent.push(key);
          return this.voices.get(key) || this.narrator;
        }
        return this.recent.length ? this.voices.get(this.recent[this.recent.length - 1]) || this.narrator : this.narrator;
      }
      const w = who.toLowerCase();
      if (w === "he" || w === "she") {
        const g = this.gender(who);
        // "she said" usually means the woman just mentioned, else the last speaker of that gender.
        for (let i = mentions.length - 1; i >= 0; i--) {
          if (this.gender(mentions[i]) === g) {
            const key = firstName(mentions[i]);
            this.recent.push(key);
            return this.voiceForName(key, g);
          }
        }
        for (let i = this.recent.length - 1; i >= 0; i--) {
          const key = this.recent[i];
          if (this.gender(key) === g) { this.recent.push(key); return this.voices.get(key); }
        }
        const key = `<${w}>`;
        this.recent.push(key);
        return this.voiceForName(key, g);
      }
      const key = firstName(who);
      this.recent.push(key);
      return this.voiceForName(key, this.gender(who));
    }
  }

  // [{quote, text}], quote marks removed. A closing quote with no opening one (dialogue continued
  // from the previous page) makes the text before it a quote.
  function splitDialogue(text) {
    const out = [];
    const firstClose = text.indexOf("”"), firstOpen = text.indexOf("“");
    let inQuote = firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen);
    let buf = "";
    for (const ch of text) {
      if (!inQuote && (ch === "“" || ch === '"')) { out.push({ quote: false, text: buf }); buf = ""; inQuote = true; }
      else if (inQuote && (ch === "”" || ch === '"')) { out.push({ quote: true, text: buf }); buf = ""; inQuote = false; }
      else buf += ch;
    }
    out.push({ quote: inQuote, text: buf });
    return out.filter((s) => s.text.trim());
  }

  // [{text, voice}] for one page: narration in the narrator voice, each quote in its speaker's.
  function assignVoices(text, cast) {
    cast.learn(text);
    const segs = splitDialogue(text);
    const result = [];
    const mentions = [];
    segs.forEach((seg, i) => {
      if (!seg.quote) {
        result.push({ text: seg.text.trim(), voice: cast.narrator, quote: false });
        for (const m of seg.text.match(NAME_RE) || []) if (!NOT_NAMES.has(m.split(" ")[0])) mentions.push(m);
        return;
      }
      let who = null;
      const after = i + 1 < segs.length && !segs[i + 1].quote ? segs[i + 1].text : "";
      const before = i > 0 && !segs[i - 1].quote ? segs[i - 1].text : "";
      // “…,” she said — but “… patient.” He sighed. starts a new sentence.
      const m = /[,?!—–…-]\s*$/.test(seg.text) ? after.slice(0, 80).match(AFTER) : null;
      if (m) who = m[1] || m[2];
      else {
        const b = before.slice(-120).match(BEFORE);
        if (b) who = b[1];
      }
      if (who && NOT_NAMES.has(who.split(" ")[0]) && !/^(he|she)$/i.test(who)) who = null;
      result.push({ text: seg.text.trim(), voice: cast.speakerVoice(who, mentions.slice(-3)), quote: true });
    });
    const merged = [];
    for (const r of result) {
      const last = merged[merged.length - 1];
      if (last && last.voice === r.voice && last.quote === r.quote) last.text += " " + r.text;
      else merged.push({ ...r });
    }
    return merged;
  }

  global.MarginDialogue = { Cast, assignVoices, splitDialogue, FEMALE_VOICES, MALE_VOICES };
})(typeof window !== "undefined" ? window : globalThis);
