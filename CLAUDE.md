# Working in this repo

- `npm test && npm run typecheck` must pass before any commit. Tests run with `TZ=UTC`.
- Changing voice rules: add phrases to `packages/core/test/fixtures/test-phrases.json` first, then bump `RULES_VERSION`.
- Never write or change medical wording (drug list, ranges, template, completeness flags, examples). Mark gaps `PENDING MEDICAL REVIEW` and ask.
- Never put patient data in URLs, localStorage/sessionStorage, the clipboard, console/server logs, or analytics. Don't add analytics or crash-reporting SDKs.
- The chart is computed from the event log. Never mutate events; add new ones. Keep phone and server invariant checks identical (`ChartLog.check`).
- Nothing becomes a chart entry without a human tap. Never add a "guidance" source in Track 1.
- Wording in UI and docs: "in development", "tested on mock patients only". Never "FDA-cleared", "HIPAA-compliant", "AI medic", "listens to the scene", "AI decides".
- Update `docs/quality/requirements.md` and `risk-register.md` when behaviour tied to a REQ or HAZ changes.
