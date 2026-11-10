# Risk register — Core v1

Severity and likelihood are engineering placeholders until Dr. Lang reviews them. "Residual" is what remains after the listed controls.

| ID | Hazard | Cause | Controls in v1 | Verified by | Residual / open |
|---|---|---|---|---|---|
| HAZ-01 | Wrong value in the chart | Mis-heard number; rule bug; wrong field | Confirm cards with source quote; range warnings; deterministic rules tested on 104 phrases; correct = void + replace; append-only log | REQ-010..016, REQ-020 | Real-world speech error rates unknown until device tests with SAR medics. Phrase set must grow from real recordings (transcripts only). |
| HAZ-02 | Wrong drug | Sound-alike drug names | Fixed drug list; fuzzy match with margin; unclear → candidates, Accept disabled until a human picks; unknown → "not on the drug list" | REQ-013; phrases.test HAZ-02 | Drug list pending medical review. |
| HAZ-03 | Wrong recommendation | Guidance logic | Not in v1. Log rejects source "guidance". | REQ-022 | Track 2 only. |
| HAZ-04 | Guidance used on a real patient | Training content reaching live care | No guidance in v1; pilot build is TRAINING-only, expires | REQ-022, REQ-070 | — |
| HAZ-05 | Audio leaves the phone | Cloud speech fallback; plugin behaviour | Forced on-device flag; voice disabled if on-device unavailable; no audio stored | REQ-001..003 | **Open until W0-1 and W0-2 pass on iOS and Android.** |
| HAZ-06 | Chart lost before sync | Dead phone, app killed, failed sync, early delete | Every event written to encrypted storage immediately; delete only after close + server confirm + 12 h; 24 h unsynced warning; server confirms gapless prefix only | REQ-030..033 | Storage durability on device W0-3. |
| HAZ-07 | Data exposed on the phone | Lost/unlocked phone, app switcher, logs | App lock, privacy screen, SQLCipher, no PHI in URLs/logs/storage APIs | REQ-050..052 | WebView caches W0-3. Personal devices: team policy needed (Steve's feedback). |
| HAZ-08 | Timer wrong | Wrong spoken time; clock drift; app in background | Times from logged events; "at HH:MM" override; minutes recomputed on screen | REQ-016, REQ-023 | No lock-screen timer yet (W0-6). Phone clock not verified against server. |
| HAZ-09 (proposed) | Phone dies mid-incident | Battery drain from screen + mic in cold | Push-to-talk (mic off by default); keep-awake only on handoff screen; tap charting as fallback | — | Battery test W0-7. Add to register if Dr. Lang agrees. |
