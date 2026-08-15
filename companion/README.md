# Margin companion — README

AI narration companion for the X4 Pro e-reader.

## What it does

1. Connects to the X4 Pro over BLE (device advertises as **"Margin"**)
2. Receives the current page text every time you turn a page
3. Speaks it aloud via iOS TTS → AirPods / headphones

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

## Running during development

```bash
npx expo start
# Open the Expo dev app on your iPhone → scan the QR code
```

## Usage

1. Open a book on the X4 Pro (BLE advertising starts automatically)
2. Open Margin on your iPhone → tap **Connect to Reader**
3. Turn a page → iPhone speaks the page text aloud
4. Tap **🔊 Speaking** to mute / unmute
5. App stays connected in the background (BLE + audio background modes enabled)

## BLE protocol

See `shared/protocol/ble.md` for the full GATT spec.

## Future

- Pause on voice detection (ambient audio privacy boundary)
- Push-to-talk discussion grounded in the current passage
- Highlight sync: X4 highlights the sentence being spoken
