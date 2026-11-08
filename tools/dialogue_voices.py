"""Give dialogue its own voices: find quoted speech, guess who says it and their
gender, and give each character a consistent voice distinct from the narrator.

Heuristics only (no model): attribution from nearby "said he / she asked /
Marlow replied", gender from pronouns, titles, a short first-name list, and
how the book itself refers to a name ("Marlow ... his"). Unattributed lines
alternate between the last two speakers, as written dialogue usually does.
It will sometimes guess wrong; the narrator voice is the fallback.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

SPEECH_VERBS = (
    "said|says|say|asked|asks|replied|replies|answered|answers|whispered|whispers|shouted|shouts|"
    "yelled|called|cried|muttered|murmured|added|continued|began|told|tells|snapped|exclaimed|"
    "insisted|explained|laughed|sighed|repeated|demanded|admitted|agreed|warned|offered|pleaded|"
    "protested|suggested|announced|declared|observed|remarked|retorted|interrupted|breathed|growled"
)
NAME = r"(?:(?:Mr|Mrs|Ms|Miss|Dr|Sir|Lady|Lord|Uncle|Aunt|Captain|Professor)\.? )?[A-Z][a-z]+(?: [A-Z][a-z]+)?"
WHO = rf"\b((?i:he|she)|{NAME})"
# "…,” Marlow said / she asked   and   “…,” said Marlow
AFTER = re.compile(rf"^\s*(?:{WHO}\s+(?:{SPEECH_VERBS})\b|(?:{SPEECH_VERBS})\s+{WHO}\b)")
# Marlow said, “…   /   She turned to him and asked: “…
BEFORE = re.compile(rf"{WHO}\s+(?:[^.!?“”\"\s]+\s+){{0,10}}?(?:{SPEECH_VERBS})\b[^.!?“”\"]{{0,40}}[,:]?\s*$")
NAME_RE = re.compile(rf"\b{NAME}\b")

FEMALE_TITLES = {"mrs", "ms", "miss", "lady", "aunt", "queen", "madam", "sister", "mother"}
MALE_TITLES = {"mr", "sir", "lord", "uncle", "king", "father", "brother"}
NOT_NAMES = {
    "The", "A", "An", "But", "And", "Then", "When", "If", "It", "He", "She", "They", "We", "I", "You",
    "His", "Her", "Their", "This", "That", "There", "What", "Why", "How", "Yes", "No", "Oh", "Well",
}
# A small seed list; the book's own pronoun use refines and overrides it.
FEMALE_NAMES = set("""
mary anna emma elizabeth sarah jane margaret susan alice catherine kate katherine grace lucy
charlotte emily olivia sophia sophie isabella mia amelia ava ella chloe hannah laura julia rose
helen ruth anne annie clara eleanor ellen frances martha nancy rebecca rachel linda karen lisa
jennifer jessica amy maria elena eva claire diana dorothy jean joan judith marie natalie nina
nora paula sandra sylvia teresa victoria wendy zoe beth daisy esther harriet irene lily louise
lydia mabel maggie marian matilda molly polly rosie stella violet hermione ginny luna petunia
""".split())
MALE_NAMES = set("""
john james robert michael william david richard joseph thomas charles christopher daniel matthew
george henry edward peter paul mark steven andrew kenneth joshua kevin brian timothy ronald
jason jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott frank brandon
benjamin samuel gregory alexander patrick jack dennis jerry tyler aaron adam nathan harry
arthur albert alfred fred frederick hugh ian leo louis max oliver oscar ralph roger simon
tom tony victor walter will bill bob jim joe mike nick sam ben dan ted ron harry hagrid draco
neville sirius remus severus marlow holmes watson
""".split())

NARRATOR = "af_heart"
FEMALE_POOL = ["af_bella", "bf_emma", "af_nicole", "bf_isabella", "af_sarah"]
MALE_POOL = ["am_michael", "bm_george", "am_adam", "bm_lewis", "am_eric"]


def _first_name(name: str) -> str:
    parts = name.replace(".", "").split()
    return parts[1] if len(parts) > 1 and parts[0].lower() in FEMALE_TITLES | MALE_TITLES else parts[0]


class Cast:
    """Remembers characters, their guessed gender and voice across pages of a book."""

    def __init__(self, narrator: str = NARRATOR) -> None:
        self.narrator = narrator
        self.female_pool = [v for v in FEMALE_POOL if v != narrator]
        self.male_pool = [v for v in MALE_POOL if v != narrator]
        self.votes: dict[str, Counter] = defaultdict(Counter)
        self.voices: dict[str, str] = {}
        self.recent: list[str] = []  # last speakers, newest last

    # --- learning from narration -------------------------------------------------
    def learn(self, text: str) -> None:
        """'Marlow ... his' votes male for Marlow (within one sentence)."""
        for sentence in re.split(r"(?<=[.!?…])\s+", text):
            m = re.search(rf"\b({NAME})\b[^.!?“”\"]{{1,80}}?\b(he|his|him|himself|she|her|hers|herself)\b", sentence)
            if m and m.group(1).split()[0] not in NOT_NAMES:
                female = m.group(2).lower().startswith(("she", "her"))
                self.votes[_first_name(m.group(1))]["f" if female else "m"] += 1

    def gender(self, who: str) -> str | None:
        w = who.lower()
        if w == "he":
            return "m"
        if w == "she":
            return "f"
        title = w.replace(".", "").split()[0]
        if title in FEMALE_TITLES:
            return "f"
        if title in MALE_TITLES:
            return "m"
        first = _first_name(who)
        v = self.votes.get(first)
        if v and v["m"] != v["f"]:
            return "m" if v["m"] > v["f"] else "f"
        if first.lower() in FEMALE_NAMES:
            return "f"
        if first.lower() in MALE_NAMES:
            return "m"
        return None

    # --- choosing a voice ----------------------------------------------------------
    def _voice_for_name(self, key: str, gender: str | None) -> str:
        if key not in self.voices:
            pool = self.female_pool if gender == "f" else self.male_pool if gender == "m" else []
            used = set(self.voices.values())
            free = [v for v in pool if v not in used] or pool
            self.voices[key] = free[0] if free else self.narrator
        return self.voices[key]

    def speaker_voice(self, who: str | None, mentions: list[str] | None = None) -> str:
        if who is None:
            # Unattributed: alternate with the previous speaker in this exchange.
            if len(self.recent) >= 2:
                key = self.recent[-2]
                self.recent.append(key)
                return self.voices.get(key, self.narrator)
            return self.narrator if not self.recent else self.voices.get(self.recent[-1], self.narrator)
        if who.lower() in ("he", "she"):
            g = self.gender(who)
            # "she said" usually means the woman just mentioned ("Mira pulled her coat. 'Walk?' she said"),
            # else the most recent speaker of that gender.
            for name in reversed(mentions or []):
                if self.gender(name) == g:
                    key = _first_name(name)
                    self.recent.append(key)
                    return self._voice_for_name(key, g)
            for key in reversed(self.recent):
                if self.gender(key) == g:
                    self.recent.append(key)
                    return self.voices[key]
            key = f"<{who.lower()}>"
            self.recent.append(key)
            return self._voice_for_name(key, g)
        key = _first_name(who)
        self.recent.append(key)
        return self._voice_for_name(key, self.gender(who))


def split_dialogue(text: str) -> list[tuple[bool, str]]:
    """[(is_quote, text)], keeping the quote marks out of spoken text. A closing
    quote with no opening one (dialogue continued from the previous page) makes
    the text before it a quote."""
    out: list[tuple[bool, str]] = []
    opens, closes = "“\"", "”\""
    i, n, in_quote = 0, len(text), False
    first_close, first_open = text.find("”"), text.find("“")
    if first_close != -1 and (first_open == -1 or first_close < first_open):
        in_quote = True
    buf = []
    while i < n:
        ch = text[i]
        if not in_quote and ch in opens:
            out.append((False, "".join(buf)))
            buf, in_quote = [], True
        elif in_quote and ch in closes:
            out.append((True, "".join(buf)))
            buf, in_quote = [], False
        else:
            buf.append(ch)
        i += 1
    out.append((in_quote, "".join(buf)))
    return [(q, t) for q, t in out if t.strip()]


def assign_voices(text: str, cast: Cast) -> list[tuple[str, str]]:
    """[(text, voice)] for a page: narration in the narrator voice, each quote in its speaker's."""
    cast.learn(text)
    segs = split_dialogue(text)
    result: list[tuple[str, str]] = []
    mentions: list[str] = []  # names in the narration so far on this page, in order
    for i, (is_quote, seg) in enumerate(segs):
        if not is_quote:
            result.append((seg.strip(), cast.narrator))
            mentions += [m for m in NAME_RE.findall(seg) if m.split()[0] not in NOT_NAMES]
            continue
        who = None
        after = segs[i + 1][1] if i + 1 < len(segs) and not segs[i + 1][0] else ""
        before = segs[i - 1][1] if i > 0 and not segs[i - 1][0] else ""
        # “…,” she said  /  “…?” he asked   — but “… patient.” He sighed. starts a new sentence.
        m = AFTER.search(after[:80]) if re.search(r"[,?!—–…-]\s*$", seg) else None
        if m:
            who = m.group(1) or m.group(2)
        else:
            m = BEFORE.search(before[-120:])
            if m:
                who = m.group(1)
        if who and who.split()[0] in NOT_NAMES and who.lower() not in ("he", "she"):
            who = None
        result.append((seg.strip(), cast.speaker_voice(who, mentions[-3:])))
    # Merge neighbours with the same voice so speech flows.
    merged: list[tuple[str, str]] = []
    for seg, voice in result:
        if merged and merged[-1][1] == voice:
            merged[-1] = (f"{merged[-1][0]} {seg}", voice)
        else:
            merged.append((seg, voice))
    return merged
