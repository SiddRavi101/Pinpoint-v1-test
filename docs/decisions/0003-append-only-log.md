# 0003 — Append-only event log as the source of truth

**Status:** accepted · 2026-11-10

**Decision.** A chart is a gapless sequence of events (`chart_opened`, `entry`, `entry_voided`, `chart_closed`, `sync_confirmed`). The chart on screen, the handoff and the review page are all computed from it. Corrections void and replace. The same invariant checks run on the phone and on the server.

**Consequences.** Full audit trail and simple sync (send everything; server is idempotent and confirms the gapless prefix). Server receipts are events too, so deletion can be decided from the log alone. Cost: projection on every render, negligible at one patient per chart.
