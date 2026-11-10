# Native setup (needs a Mac with Xcode, Android Studio, and real phones)

```bash
npm install
npm run build:field                     # builds apps/field/dist
cd apps/field
npx cap add ios && npx cap add android  # once
npx cap sync
npx cap open ios                        # or: npx cap open android
```

## iOS — `ios/App/App/Info.plist`
```xml
<key>NSMicrophoneUsageDescription</key>
<string>Pinpoint uses the microphone only while you hold the talk button, to turn your words into chart entries on this phone.</string>
<key>NSSpeechRecognitionUsageDescription</key>
<string>Speech is turned into text on this phone. Audio is not saved or sent.</string>
<key>NSFaceIDUsageDescription</key>
<string>Unlock your charts.</string>
```
- Signing & Capabilities → Data Protection: **Complete**.
- Settings → General → Keyboard → Dictation languages: make sure English is downloaded so on-device recognition is available offline.
- TestFlight: internal testers only during the pilot.

## Android — `android/app/src/main/AndroidManifest.xml`
```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
<queries><intent><action android:name="android.speech.RecognitionService" /></intent></queries>
```
- Set `android:allowBackup="false"` on `<application>`.
- Download the offline English speech pack (Settings → Google → Voice / "Offline speech recognition"). On-device recognition needs Android 13+ on most phones; on older ones voice turns off.

## Build-time settings
`VITE_PILOT=true` (default), `VITE_BUILD_EXPIRES=2026-12-31T23:59:00Z`, `VITE_DEFAULT_SERVER=https://sync.example.org`.

## Server
```bash
PINPOINT_DEVICE_TOKENS="phone-1:<random>,phone-2:<random>" \
PINPOINT_REVIEW_TOKEN="<random, 16+ chars>" \
PINPOINT_ORIGINS="capacitor://localhost,https://localhost" \
npm run dev:server
```
Run behind HTTPS (e.g. Caddy). The SQLite file in `server/data/` holds patient data in real use: put it on an encrypted disk with backups and restricted access. For the pilot, mock patients only.

Then run the week-0 checks in `docs/quality/verification.md`.
