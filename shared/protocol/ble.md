# Margin BLE protocol

## Device advertisement

The X4 Pro firmware (Muse) advertises as **"Margin"** over BLE once a book is
opened (`EpubReaderActivity::onEnter`). The device name and service UUID are
stable across firmware updates.

## GATT service

| Role | UUID |
|------|------|
| Service | `4D555345-0001-1000-8000-000000000000` |
| Page-text characteristic | `4D555345-0002-1000-8000-000000000000` |

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

All chunks belonging to one page share the same `total` value. The companion
reassembles by collecting `total` chunks, ordered by `seq`, and concatenating
their payloads.

**Example** — 350-byte page splits into 2 chunks:

```
chunk 0: [0x00][0x02][first 180 bytes…]
chunk 1: [0x01][0x02][remaining 170 bytes…]
```

Inter-chunk delay: 5 ms (firmware-side `delay(5)` between `notify()` calls).

## Companion behaviour

1. Scan for service UUID `4D555345-0001-…`.
2. Connect and subscribe to the page-text characteristic.
3. On each notify: buffer chunk → when `chunkBuf.size == total`, reassemble
   and pass assembled text to `Speech.speak()`.
4. Interrupt any in-progress speech before speaking the new page.
5. Background mode: declare `bluetooth-central` + `audio` in `UIBackgroundModes`
   so the app keeps the BLE connection and can speak while the screen is off.

## Companion app

Lives in `companion/`. Built with Expo + `react-native-ble-plx` + `expo-speech`.
Requires a custom dev build (EAS) — **not compatible with standard Expo Go**
because `react-native-ble-plx` uses native modules.

```bash
cd companion
npm install
npx eas-cli login        # free Expo account
npx eas build --profile development --platform ios
# EAS emails an install link (~15 min build in cloud, no Xcode needed)
npx expo start           # then scan QR from the installed dev app
```

## WiFi / HTTP endpoint (debug)

`GET http://<device-hotspot-ip>/api/reading` — returns the locator JSON while
the web-server activity is active. Not needed for narration; useful for
debugging position without the companion app. See `shared/protocol/locator.md`.
