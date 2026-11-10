# 0001 — React web app inside Capacitor

**Status:** accepted · 2026-11-10

**Context.** Two-to-three-person team, iOS and Android both needed (SAR members bring their own phones), web skills on the team, a deadline measured in weeks.

**Decision.** One React + TypeScript app wrapped with Capacitor 8. Native capabilities through maintained plugins: Capgo speech recognition (forced on-device), Capgo native biometric, community SQLite (SQLCipher), privacy screen, keep-awake, text-to-speech.

**Consequences.** One codebase and a browser preview for fast iteration. Native behaviour (speech privacy, storage, lock) depends on plugins and must be verified on devices (W0 checks). A lock-screen tourniquet timer needs native code (Live Activity / ongoing notification) later. If W0-1 fails on a platform, voice stays off there and tap charting remains.
