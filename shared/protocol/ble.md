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

## Control characteristic

**Properties:** WRITE, WRITE_NR (write without response)

**Value:** one command byte.

| Byte | Command | Effect |
|------|---------|--------|
| `0x01` | `NEXT_PAGE` | The reader turns forward as if the page-forward button were pressed, through the same debounce. |

A `NEXT_PAGE` is ignored outside the reader, on the last page of the book (it
does not leave the book), and if the reader has not consumed it within 3 s. Any
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
   Reading modes (web companion): *I'll read* (no speech), *Read to me* (speak
   each page, stop), *Read continuously* (when a page finishes speaking, write
   `NEXT_PAGE`; an empty page triggers `NEXT_PAGE` immediately).
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

## Not yet implemented

Book metadata (title/author/page) is not sent over BLE yet; UUID
`4D555345-0003-…` is reserved for it. Title and author are available over HTTP
from `GET /api/reading` meanwhile.

## WiFi / HTTP endpoint (debug)

`GET http://<device-hotspot-ip>/api/reading` — returns the locator JSON while
the web-server activity is active. Not needed for narration; useful for
debugging position without the companion app. See `shared/protocol/locator.md`.
