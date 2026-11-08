# Margin companion — README

AI narration companion for the X4 Pro e-reader.

## What it does

1. Connects to the X4 Pro over BLE (device advertises as **"Margin"**)
2. Receives the current page text every time you turn a page
3. Speaks the page aloud via iOS TTS → AirPods / headphones, in one of three modes:
   - **I'll read**: silent; pages still arrive
   - **Read to me**: reads each page, then waits for you to turn it
   - **Continuous**: reads the page to the end, turns it on the X4, and keeps
     going (needs X4 firmware with the control characteristic). With firmware
     that answers `PEEK_NEXT`, the next page's text arrives while the current
     one is read, so the turn and the next page start together.
4. Keeps narrating with the screen locked (spoken-audio session + BLE background mode)
5. Offers Premium/Enhanced iOS voices and your Personal Voice, hides robotic novelty voices
6. Optional on-device neural voice (**Kokoro**, via `react-native-executorch` on the CPU/XNNPACK
   backend, played through `react-native-audio-api`). Settings › Voice › Neural voice starts a
   one-time ~330 MB model download; the iPhone voice reads until it is ready. Nothing leaves
   the phone (executorch telemetry is turned off).
7. Remembers mode, voice, speed, and auto-connect preferences between launches

## Prerequisites

- iPhone on iOS 17+ (deployment target set in `app.json` via `expo-build-properties`)
- Node 20.19.4+ (Expo SDK 55 / React Native 0.83)
- Free [Expo account](https://expo.dev/signup)

## First-time setup (no Xcode needed)

```bash
cd companion
npm ci
npm install -g eas-cli

eas login                    # sign in with your Expo account
eas init                     # once: sets the projectId in app.json (commit it)
eas build --profile development --platform ios
# EAS builds in the cloud (~15 min). You get an install link by email.
# Tap the link on your iPhone to install the dev build.
```

## Running during development

```bash
npx expo start
# Open the installed development build on your iPhone → scan the QR code
```

Standard Expo Go will not work because `react-native-ble-plx` requires native
modules. A dev build made before the Expo SDK 55 upgrade will not load the
current JS; make a fresh `eas build --profile development --platform ios`.

## Usage

1. Open a book on the X4 Pro and turn a page (BLE advertising starts then)
2. Open Margin on your iPhone
3. Let auto-connect find the reader, or tap **Connect** on the pairing screen
4. Tap **Open Now Reading** once connected
5. Turn a page → iPhone speaks the page text aloud
6. Open **Settings** any time to choose voice, adjust speed, or toggle auto-connect

The reading screen shows a generic title: the firmware doesn't send book
metadata over BLE yet.

## Checking changes without a Mac

```bash
npx tsc --noEmit -p .                                   # typecheck
npx expo export --platform ios --output-dir /tmp/margin  # bundle the iOS JS
```

CI runs both on every PR. The EAS build itself runs on pushes to `main` (or a
manual run) once `EXPO_TOKEN` is set and `eas init` has filled in the projectId.

## Native code

`modules/margin-voices/` is a local Expo module (Swift, autolinked from
`./modules`): real voice quality and Personal Voice/novelty traits, Personal
Voice authorization (iOS 17+), and the playback audio session. Speaking itself
still goes through `expo-speech`. In a build without the module the app falls
back to `expo-speech`'s voice list. Pure narration logic (sentence splitting,
hyphen rejoining) is in `src/narration.ts`.

## Dependency notes

- `react-native-worklets` is pinned to 0.12.x (executorch needs ≥0.10, React Native 0.83 caps it
  below 0.13) instead of SDK 55's 0.7.4, so it is listed in `expo.install.exclude`.
  `babel-preset-expo` adds its Babel plugin automatically; no `babel.config.js` is needed.
- `package.json` › `react-native-executorch` limits the native libraries executorch downloads at
  install time to text-to-speech on XNNPACK.
- `react-native-audio-api` is pinned to 0.13.x; its Expo plugin adds the `audio` background mode
  and disables FFmpeg (only raw PCM is played).

## BLE protocol

See `shared/protocol/ble.md` for the page-text transport contract and
`src/pageAssembler.ts` for the reassembly/UTF-8 decoding.

## Future

- Pause on voice detection (ambient audio privacy boundary)
- Push-to-talk discussion grounded in the current passage
- Highlight sync: X4 highlights the sentence being spoken
- On-device neural voice (Kokoro via react-native-executorch; app is on Expo SDK 55, New Architecture, iOS 17+)
