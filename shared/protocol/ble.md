# Margin BLE protocol

## Device advertisement

The X4 Pro firmware (Muse) advertises as **"Margin"** over BLE from the first
time the reader saves progress in a book (`EpubReaderActivity::saveProgress()`
calls `MuseBleServer::init()`), and keeps advertising until reboot. The device
name and service UUID are stable across firmware updates.

## GATT service

| Role | UUID |
|------|------|
| Service | `4D555345-0001-1000-8000-000000000000` |
| Page-text characteristic | `4D555345-0002-1000-8000-000000000000` |
| Book-info characteristic | `4D555345-0003-1000-8000-000000000000` |
| Book-notes characteristic | `4D555345-0005-1000-8000-000000000000` |
| Control characteristic | `4D555345-0004-1000-8000-000000000000` |

UUID mnemonic: first 4 bytes = **MUSE** in ASCII (4D 55 53 45).

## Page-text characteristic

**Properties:** NOTIFY (subscribe; no read/write needed)

**Trigger:** Fires on every page turn, immediately after the e-ink display
commits the new page. Initiated in `EpubReaderActivity::saveProgress()`.

**Value format — chunked UTF-8:**

```
byte 0  : seq          uint8   0-based chunk index
byte 1  : total        uint8   total number of chunks for this page
bytes 2…: text payload UTF-8   up to 180 bytes
```

All chunks belonging to one page share the same `total` value and are sent in
order, `seq` 0 first. Chunk boundaries are raw byte offsets, so **a chunk may
end in the middle of a UTF-8 character**: concatenate the payload bytes of all
chunks first, then decode. Pages longer than 4096 bytes are cut at the last
whole UTF-8 character. A page with no text (an image, a blank page) is sent
as one empty chunk, `[0x00][0x01]`, so a companion reading continuously knows
the page changed; companions must not speak an empty page.

**Example** — 350-byte page splits into 2 chunks:

```
chunk 0: [0x00][0x02][first 180 bytes…]
chunk 1: [0x01][0x02][remaining 170 bytes…]
```

Inter-chunk delay: 5 ms (firmware-side `delay(5)` between `notify()` calls).

## Book-info characteristic

**Properties:** READ, NOTIFY. Notified just **before** each page's text (page turns and
`SEND_CURRENT`; not for previews), and readable at any time. Value: compact UTF-8 JSON,
one packet (title cut to 80 bytes and author to 50, at a character boundary):

```json
{"b":"9f3a61c2","ch":4,"chs":31,"pg":12,"last":0,"t":"The Art of Strategy","a":"Dixit, Nalebuff"}
```

| Key | Meaning |
|-----|---------|
| `b` | Book id: FNV-1a 32-bit hash of the book's file path (stable per book; the path is not sent) |
| `ch` / `chs` | Chapter (spine item) index, and number of spine items |
| `pg` | Page index within the chapter |
| `last` | `1` on the chapter's last page (known only once the chapter is fully laid out) |
| `t` / `a` | Title / author |

Companions use `b` to remember per-book settings (e.g. character voices) and `last` for
"stop at the end of the chapter". Firmware without it simply lacks the characteristic.

## Book-notes characteristic

**Properties:** READ, WRITE (≤ 512 bytes; long writes). Companion-defined JSON kept **on the X4**
per book, so it follows the book to any companion. It must contain the book's id as `"b":"…"`
(from book info); the reader saves it to `margin.json` in that book's cache folder on the SD
card (from its main loop, not the BLE task) and ignores notes written for another book.
Reading returns the open book's notes (empty if none yet).

The companions use it to remember character voices:

```json
{"b":"9f3a61c2","n":"Bella","g":[["Tavish",1,0],["Mira",0,2]],"v":[["Tavish","Jasper"],["Mira","Luna"]]}
```

`n` narrator voice; `g` per name: male/female pronoun votes; `v` voice per character.

## Control characteristic

**Properties:** WRITE, WRITE_NR (write without response)

**Value:** one command byte.

| Byte | Command | Effect |
|------|---------|--------|
| `0x01` | `NEXT_PAGE` | The reader turns forward as if the page-forward button were pressed, through the same debounce. |
| `0x02` | `PEEK_NEXT` | The reader sends the **next** page's text as a preview, without turning. |
| `0x03` | `SEND_CURRENT` | The reader sends the page on screen now (normal page-text chunks), so a companion that just connected can start reading without waiting for a page turn. A companion that receives the page it is already reading (e.g. after a reconnect) should keep going, not restart. |
| `0x04` | `HIGHLIGHT` | Followed by four little-endian u16: chapter, page (as in book info `ch`/`pg`), first and last word to underline. Words are numbered in the page text (words joined by single spaces, 0-based). `first = 0xFFFF` clears. Ignored unless chapter/page match the page on screen. The X4 draws the underline into its framebuffer and does a fast refresh (no full re-render; the full-refresh cadence is untouched). |

A preview uses the page-text format with `0x80` set on every `seq` byte
(`[0x80|seq][total][utf8…]`). An empty preview (`[0x80][0x01]`) means the next
page is not available yet (e.g. it is in a chapter not laid out yet) or has no
text; the companion then turns first and reads the page when it arrives.
Companions that predate previews discard these chunks (their `seq` never
matches), so previews are only sent when asked for.

A `NEXT_PAGE` is ignored outside the reader, on the last page of the book (it
does not leave the book), and if the reader has not consumed it within 3 s
(`PEEK_NEXT` and `SEND_CURRENT` likewise expire after 3 s). Any
control write also holds off auto-sleep for 2 minutes, so the X4 stays awake
while a companion is reading aloud continuously.

Firmware without this characteristic predates continuous reading; companions
should detect its absence and offer only the manual modes.

## Companion behaviour

1. Scan for service UUID `4D555345-0001-…`.
2. Connect and subscribe to the page-text characteristic.
3. On each notify (`companion/src/pageAssembler.ts`):
   - `seq == 0` starts a new page and discards any partial one;
   - any other chunk must be the next `seq` with the same `total`, otherwise
     the partial page is discarded (a notify was dropped) — never mix pages;
   - after chunk `total - 1`, concatenate the bytes, decode UTF-8, and pass
     the text to `Speech.speak()`.
4. Interrupt any in-progress speech before speaking the new page.
   Reading modes: *I'll read* (no speech), *Read to me* (speak each page,
   stop), *Continuous* (when a page finishes speaking, write `NEXT_PAGE`; an
   empty page triggers `NEXT_PAGE` immediately).
   Gapless continuous reading: after a page arrives, write `PEEK_NEXT` and
   prepare the preview's audio while the page is read; when it finishes, write
   `NEXT_PAGE` and start the preview at once. The real page that follows the
   turn is then only a confirmation: if its text equals the preview, keep
   going; if not (the reader jumped), speak the real page instead. If no
   preview arrives within ~2 s, assume firmware without `PEEK_NEXT` and fall
   back to turn-then-read.
5. Background mode: declare `bluetooth-central` + `audio` in `UIBackgroundModes`
   so the app keeps the BLE connection and can speak while the screen is off.

## Companion app

Lives in `companion/`. Built with Expo + `react-native-ble-plx` + `expo-speech`.
Requires a custom dev build (EAS) — **not compatible with standard Expo Go**
because `react-native-ble-plx` uses native modules.

```bash
cd companion
npm ci
npx eas-cli login        # free Expo account
npx eas-cli init         # once: sets the EAS projectId in app.json
npx eas-cli build --profile development --platform ios
# EAS emails an install link (~15 min build in cloud, no Xcode needed)
npx expo start           # then scan QR from the installed dev app
```

## WiFi / HTTP endpoint (debug)

`GET http://<device-hotspot-ip>/api/reading` — returns the locator JSON while
the web-server activity is active. Not needed for narration; useful for
debugging position without the companion app. See `shared/protocol/locator.md`.
