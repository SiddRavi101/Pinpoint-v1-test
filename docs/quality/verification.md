# Verification record

## Automated (run on every change: `npm test && npm run typecheck`)

| Date | Commit | Suite | Result |
|---|---|---|---|
| 2026-11-10 | initial | core: phrases (108, set `sccssar-style-v0.1`), core (21), server (7), field logic + sync against real server (7) | 143 / 143 pass; typecheck clean; `vite build` OK |

| 2026-11-10 | transcript, whisper, form, transfer | core (incl. transcript 5, form 65, transfer 7), server, field logic + whisper | 230 / 230 pass; typecheck clean; `vite build` OK |

Phrase set `sccssar-style-v0.1` was written by engineering in the style of SAR radio/charting speech. It is **not** from real patients or real recordings. Replace or extend with transcripts from Santa Clara County SAR training sessions.

## Browser preview (typed input in place of voice)

2026-11-10, Chromium 400×860: setup → new training chart → typed utterance with pulse, BP, SpO2, tourniquet, sound-alike drug ("zofrin"), allergy → 5 clear cards + 1 held for a drug pick → accept → handoff with QR (177/350 chars). No console errors.

2026-11-10, Chromium 390×844 (built preview): setup → new training chart → 4 typed utterances → Form tab fills live (ink vs card waiting), Transcript shows each line with clock time and linked entries, Review lists unmatched drug, waiting cards and every entry → handoff text QR and animated full-chart QR → Paper forms screen. No console errors, no requests off localhost. Service worker: offline reload loads the app. Full-chart QR: 142-event chart received through Chromium's fake camera via jsQR. Form scan: synthetic blank SAR form, 33/33 labels and bindings, no network requests. **Whisper inference not run** (model host blocked in the build environment).

## Week-0 device checks (must pass before any field use)

Record device model, OS version, build, tester, date and result for each.

| ID | Check | How | iOS | Android |
|---|---|---|---|---|
| W0-1 | On-device speech only | Airplane mode + Wi-Fi off: voice still works. With network on: proxy/network monitor shows no traffic to speech services while talking. If `isOnDeviceRecognitionAvailable` is false, voice shows "off". | | |
| W0-2 | No audio stored or sent | Network monitor (e.g. Charles/mitmproxy) during a 10-min mock patient; inspect app container for audio files. | | |
| W0-3 | Storage encrypted, no WebView leaks | Pull app container; DB unreadable without key; no chart text in WebView localStorage/IndexedDB/cache. | | |
| W0-4 | Lock works | Biometric + passcode fallback; locks on background; app switcher shows privacy screen. | | |
| W0-5 | QR readable | Printed size ≥ 6 cm on screen; read by stock camera of 3 other phones in sunlight and at night. | | |
| W0-6 | Tourniquet time visible when locked | Not built. Decide: Live Activity (iOS) / ongoing notification (Android). | | |
| W0-7 | Battery | 2 h mock incident at 0 °C or cold pack; record % used. | | |
| W0-8 | Outdoor accuracy | Run the phrase set aloud outdoors with wind, gloves, radio noise; record % fields correct before edits. | | |
| W0-9 | Whisper on the phone | Model bundled; airplane mode; hold-to-talk 10 phrases; record time from release to text, accuracy vs phone engine, memory, battery over 30 min. Mic permission in the web view. | | |
| W0-10 | Phone-to-phone full-chart QR | Animated QR between two phones in sun and dark; record time to receive a 30-min chart. iOS 16.4+ for compression. | | |
| W0-11 | Paper form scan | Photograph the real blank form (flat, curled, low light); count labels read and bindings right before edits. | | |
