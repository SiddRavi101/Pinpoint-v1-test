# Native setup (needs a Mac with Xcode, Android Studio, and real phones)

```bash
npm install
npm run fetch-model                     # once: Whisper model into apps/field/public/models (~80 MB, needs huggingface.co)
npm run build:field                     # builds apps/field/dist (model, speech runtime, OCR files included)
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
<key>NSCameraUsageDescription</key>
<string>Pinpoint uses the camera to scan a handoff QR code or a blank paper form. Pictures are read on this phone and not saved.</string>
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
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<queries><intent><action android:name="android.speech.RecognitionService" /></intent></queries>
```
- Set `android:allowBackup="false"` on `<application>`.
- Download the offline English speech pack (Settings → Google → Voice / "Offline speech recognition"). On-device recognition needs Android 13+ on most phones; on older ones voice turns off.

## Voice engines
Whisper (on-device, in the app's web view) is used when the model files are in the build; otherwise the phone's own on-device engine; otherwise tap charting. Microphone capture for Whisper uses `getUserMedia` in the web view: iOS 14.3+ WKWebView, and on Android Capacitor grants the web view's request once `RECORD_AUDIO` is granted. Check both on real phones (W0-9).

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
