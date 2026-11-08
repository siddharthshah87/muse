# Companion App — Deploy to iPhone (no Xcode needed)

Uses EAS cloud build. Run these commands once from any terminal:

```bash
cd companion/

# 1. Install deps (exact versions from package-lock.json)
npm ci

# 2. Log in to your Expo account (create one free at expo.dev if needed)
eas login

# 3. Register project (fills YOUR_EAS_PROJECT_ID in app.json automatically).
#    Commit the updated app.json so CI can build too.
eas init

# 4. Build dev client for iPhone (~15 min, runs in EAS cloud)
eas build --profile development --platform ios
```

After the build finishes, EAS prints an install URL.  
Open it on your iPhone → installs like TestFlight.

## First run
1. Open the Margin app on iPhone
2. Open a book on the X4 Pro and turn a page (this starts BLE advertising)
3. Tap "Connect" — it scans for the Margin BLE service, then turn another page
4. iPhone speaks the page text via TTS 🎉

## For production / App Store
Fill in `eas.json` submit section with your Apple ID, ASC App ID, Team ID,
then run: `eas submit --platform ios`
