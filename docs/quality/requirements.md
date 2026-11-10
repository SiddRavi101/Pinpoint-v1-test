# Requirements — Core v1, Track 1 (record)

Status key: **Built** = code + automated test · **Built, device check** = code done, must be verified on a real phone (week 0) · **Pending** = waiting on a person named in the plan.

Medical wording (drug list, template sections, completeness flags, "say it like this" examples) is **pending medical review** and was not written by a clinician. Engineers do not change medical wording; see change-control.md.

| ID | Requirement | Hazard | Where | Verified by | Status |
|---|---|---|---|---|---|
| REQ-001 | Voice runs only on the phone's on-device speech engine. If on-device recognition is not available, voice turns off and tap charting remains. | HAZ-05 | apps/field/src/platform/speech.ts | Device check W0-1 | Built, device check |
| REQ-002 | Audio is never saved or sent. Only the final text is passed to the rules. | HAZ-05 | speech.ts (no audio API used) | Device check W0-2 (network monitor) | Built, device check |
| REQ-003 | Push-to-talk: hold, or tap to start/tap to stop. A red "Mic on" bar shows whenever the mic is on. | HAZ-05 | components/VoiceButton.tsx | Manual UI check | Built |
| REQ-010 | Deterministic rules turn text into fields: pulse, resp, BP, SpO2, GCS, medication (drug/dose/route), tourniquet on/off + limb, allergies / NKA, patient reports, mechanism, time found, demographics, survey. | HAZ-01 | packages/core/src/rules | phrases.test.ts (104 phrases) | Built |
| REQ-011 | Every voice field keeps a source quote of at most 15 words. Leftover words become a note card; nothing spoken is silently dropped. | HAZ-01 | rules/tokens.ts, extract.ts | phrases.test.ts "no spoken words are dropped" | Built |
| REQ-012 | Nothing enters the chart without a tap. "Accept all" accepts only cards with no review warnings. | HAZ-01, HAZ-02 | logic.ts splitForAcceptAll, log.ts check() | logic.test.ts REQ-012; core.test.ts REQ-020 | Built |
| REQ-013 | Drug names are fuzzy-matched to a fixed list. An unclear match shows candidates and cannot be accepted until a person picks one; an unknown drug says "not on the drug list". | HAZ-02 | rules/fuzzy.ts, Cards.tsx | phrases.test.ts HAZ-02; logic.test.ts | Built |
| REQ-014 | Every field can be added or corrected by tapping. Forms return an error instead of guessing. | HAZ-01 | FixSheet.tsx, logic.ts entryFromForm | logic.test.ts REQ-014 | Built |
| REQ-015 | Out-of-range numbers show "Check the number" on the card. | HAZ-01 | extract.ts range checks | phrases.test.ts (review cases) | Built — ranges pending medical review |
| REQ-016 | Times: an entry takes the time it was spoken unless the medic says "at HH:MM". | HAZ-08 | rules/clock.ts | phrases.test.ts (at cases) | Built |
| REQ-020 | The chart is computed from an append-only event log. Corrections void and replace; nothing is edited in place. | HAZ-01, HAZ-06 | packages/core/src/log.ts, chart.ts | core.test.ts REQ-020 | Built |
| REQ-021 | Every event records source, confirmed, template version, rule version, device, schema version. | — | types.ts, log.ts | core.test.ts | Built |
| REQ-022 | The log rejects: unconfirmed entries, source "guidance", gaps, edits after close, voiding a missing entry. | HAZ-03, HAZ-04 | log.ts check(), validate.ts | core.test.ts; server.test.ts | Built |
| REQ-023 | Tourniquet timer and minutes since last vitals are computed from logged times. | HAZ-08 | chart.ts tourniquetMinutes, ChartScreen.tsx | core.test.ts chart projection | Built — lock-screen timer not built (W0-6) |
| REQ-030 | A chart is deleted from the phone only when closed, confirmed by the server, and 12 h have passed. | HAZ-06 | core/retention.ts, sync.ts | core.test.ts REQ-030; logic.test.ts | Built |
| REQ-031 | The server stores events idempotently, re-checks log rules, and confirms only the gapless prefix. | HAZ-06 | server/src/app.ts | server.test.ts REQ-031 | Built |
| REQ-032 | A warning shows when a chart has not synced for 24 h. | HAZ-06 | retention.ts, Home.tsx | core.test.ts REQ-030 | Built |
| REQ-033 | A failed sync never deletes anything. | HAZ-06 | sync.ts | logic.test.ts | Built |
| REQ-040 | One-page MIST handoff; read-aloud; plain-text QR ≤ 350 characters; first line TRAINING in the pilot. | HAZ-01 | core/handoff.ts, HandoffScreen.tsx | core.test.ts REQ-040 | Built — QR size on screen W0-5 |
| REQ-050 | App lock with Face ID / fingerprint and passcode fallback; locks when the app goes to background; privacy screen in app switcher. | HAZ-07 | platform/device.ts, App.tsx | Device check W0-4 | Built, device check |
| REQ-051 | Charts stored encrypted (SQLCipher) with a random key in the keychain/keystore. | HAZ-07 | platform/storage.ts | Device check W0-3 | Built, device check |
| REQ-052 | No patient data in URLs, localStorage, clipboard, logs, analytics or crash reports. No analytics or crash SDK is included. | HAZ-07 | sync.ts (chart id only in URL), server logs | server.test.ts "no PHI in logs"; code review | Built |
| REQ-060 | Review page: three completeness flags per chart for the medical director. | — | core/completeness.ts, server GET /v1/review | core.test.ts; server.test.ts | Built — flags pending Dr. Lang |
| REQ-070 | Pilot builds mark every chart TRAINING and stop opening new charts after the build expiry date. | HAZ-04 | config.ts, App.tsx | Manual check | Built |

## Not in v1 (by plan)
Guidance (Track 2), SMS, multiple patients per chart, print/PDF, web link, speaker separation, LLMs, NEMSIS export. Rescuer-to-rescuer full-chart QR ("could") is not built.
