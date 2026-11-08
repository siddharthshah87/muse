# Margin companion — README

AI narration companion for the X4 Pro e-reader.

## What it does

1. Connects to the X4 Pro over BLE (device advertises as **"Margin"**)
2. Receives the current page text every time you turn a page
3. Speaks the page aloud via iOS TTS → AirPods / headphones
4. Remembers voice, speed, and auto-connect preferences between launches

## Prerequisites

- iPhone on iOS 16+
- Node 18+
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
modules.

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

## BLE protocol

See `shared/protocol/ble.md` for the page-text transport contract and
`src/pageAssembler.ts` for the reassembly/UTF-8 decoding.

## Future

- Pause on voice detection (ambient audio privacy boundary)
- Push-to-talk discussion grounded in the current passage
- Highlight sync: X4 highlights the sentence being spoken
