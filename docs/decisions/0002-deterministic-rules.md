# 0002 — Deterministic rules, no model, between text and chart

**Status:** accepted · 2026-11-10

**Context.** The plan keeps models in the input layer only. Medical directors need to know exactly why a field has a value. Steve's feedback: no AI guidance.

**Decision.** Text from the speech engine goes through hand-written, versioned rules (`packages/core/src/rules`). Same input → same output. Each field carries its source quote and the rule version. Unclear input becomes a warning or a note card, never a guess.

**Consequences.** Medics must speak in a learnable pattern ("say it like this"). Coverage grows by adding phrases to the test set, which is also the regression suite. A model could later propose cards, but the confirm-card step and log checks stay unchanged.
