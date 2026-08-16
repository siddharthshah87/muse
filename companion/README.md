# Margin companion — README

AI narration companion for the X4 Pro e-reader.

## What it does

1. Connects to the X4 Pro over BLE (device advertises as **"Margin"**)
2. Receives the current page text every time you turn a page
3. Optionally reads book metadata (title, author, page) from a second BLE characteristic when firmware exposes it
4. Speaks the page aloud via iOS TTS → AirPods / headphones
5. Remembers voice, speed, and auto-connect preferences between launches

## Prerequisites

- iPhone on iOS 16+
- Node 18+
- Free [Expo account](https://expo.dev/signup)

## First-time setup (no Xcode needed)

```bash
cd companion
npm install
npm install -g eas-cli

eas login                    # sign in with your Expo account
eas build --profile development --platform ios
# EAS builds in the cloud (~15 min). You get an install link by email.
# Tap the link on your iPhone to install the dev build.
```

> **Note**
> This app now uses `@react-native-async-storage/async-storage` to persist voice,
> rate, and auto-connect settings. After pulling these changes, run `npm install`
> before starting Expo or creating a new EAS build.

## Running during development

```bash
npx expo start
# Open the installed development build on your iPhone → scan the QR code
```

Standard Expo Go will not work because `react-native-ble-plx` requires native
modules.

## Usage

1. Open a book on the X4 Pro (BLE advertising starts automatically)
2. Open Margin on your iPhone
3. Let auto-connect find the reader, or tap **Connect** on the pairing screen
4. Tap **Open Now Reading** once connected
5. Turn a page → iPhone speaks the page text aloud
6. Open **Settings** any time to choose voice, adjust speed, or toggle auto-connect

If the metadata characteristic is not present yet, the reading screen falls back
to generic placeholders until firmware adds it.

## BLE protocol

See `shared/protocol/ble.md` for the page-text transport contract.

The companion also listens for an optional metadata characteristic:

- Service UUID: `4D555345-0001-1000-8000-000000000000`
- Page text characteristic: `4D555345-0002-1000-8000-000000000000`
- Metadata characteristic: `4D555345-0003-1000-8000-000000000000`
- Metadata payload: `{"title":"...","author":"...","page":123}`

## Future

- Pause on voice detection (ambient audio privacy boundary)
- Push-to-talk discussion grounded in the current passage
- Highlight sync: X4 highlights the sentence being spoken
