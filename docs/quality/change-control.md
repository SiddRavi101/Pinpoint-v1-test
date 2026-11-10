# Change control (lite)

Every change goes through a pull request with:

1. **What changed and why** (one paragraph).
2. **Requirements / hazards touched** — list REQ and HAZ IDs, or "none".
3. **Tests** — `npm test && npm run typecheck` green. Rules changes must add phrases to `packages/core/test/fixtures/test-phrases.json`.
4. **Versions** — bump `RULES_VERSION` (rules), `DRUG_LIST_VERSION` (drug list), `TEMPLATE_VERSION` (template), `SCHEMA_VERSION` (event shape; needs a migration note). These are stamped on every event, so a chart always shows which logic produced it.
5. **Second reviewer** for anything touching rules, the log, retention, sync, storage or the lock.

## Medical content
Engineers never write or edit medical wording: the drug list and aliases, range limits, template sections, completeness flags, "say it like this" examples, handoff headings. Those changes come from the medical lead (Dr. Lang) in writing; the PR links that note. Anything still waiting is marked `PENDING MEDICAL REVIEW` in code.

## Releases
Pilot builds: `VITE_PILOT=true` and `VITE_BUILD_EXPIRES` set ≤ 30 days out. Record the build in verification.md with the week-0 results for that build.
