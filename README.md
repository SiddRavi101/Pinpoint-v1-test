# Pinpoint Core v1 — Track 1 (record)

Voice-first offline charting for wilderness / SAR medics. **In development. Tested on mock patients only.** Not a medical device, not cleared by any regulator, and not for real patients.

**Listen → Structure → Handoff.** Push-to-talk speech runs on the phone's own engine. Deterministic rules turn the words into timed chart fields shown as confirm cards; nothing enters the chart without a tap, and each field keeps the words it came from. The handoff is a one-page MIST summary, read-aloud, plus a plain-text QR (≤ 350 characters). Charts sync to a team server, then delete from the phone 12 h after the server confirms them.

## Layout
| Path | What |
|---|---|
| `packages/core` | Rules (numbers, drugs, clock), event log, chart projection, handoff, retention, completeness flags. Pure TypeScript, no I/O. |
| `apps/field` | React + Capacitor phone app. Browser preview uses typed input instead of voice. |
| `server` | Node 22 sync + review server (built-in `node:sqlite`, no framework). |
| `docs/quality` | Requirements, risk register, verification record, change control. |
| `docs/decisions` | Architecture decisions. |

## Run
```bash
npm install
npm test              # 143 tests (108 spoken phrases)
npm run typecheck
npm run dev:server    # http://localhost:8787 (dev tokens, see server/src/main.ts)
npm run dev:field     # http://localhost:5173 — device ID "dev", token from PINPOINT_DEVICE_TOKENS
```
Phones: see `docs/native-setup.md`, then run the week-0 checks in `docs/quality/verification.md` before any field use.

## Server API
- `POST /v1/charts/:id/events` (device token) → `{receiptId, serverEventCount, confirmedAt}`. Idempotent; 409 on conflicting events.
- `GET /v1/review` (review token) → charts with completeness flags.
- `GET /v1/charts/:id` (review token) → events, chart, flags, handoff.
- `GET /healthz`.

## Rules that don't bend
Chart = append-only event log. Every event logs source, confirmed, template and rule versions. No patient data in URLs, localStorage, clipboard, logs, analytics or crash reports. Models (only the phone's speech engine today) stay in the input layer. Engineers never write medical wording — anything waiting is marked `PENDING MEDICAL REVIEW`.
