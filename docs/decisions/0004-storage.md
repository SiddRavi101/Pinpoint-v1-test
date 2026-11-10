# 0004 — Encrypted SQLite on the phone (pending week-0 check)

**Status:** proposed · 2026-11-10

**Decision.** Store events in SQLCipher via `@capacitor-community/sqlite`, with a random 32-byte key kept by the plugin in the iOS Keychain / Android Keystore. Settings (device ID, server, token) in the same encrypted DB. Nothing in WebView localStorage or IndexedDB. Browser preview uses an in-memory store.

**Open.** W0-3 must confirm the DB file is unreadable without the key and that the WebView leaves no chart text in its caches. If the plugin's encryption fails a check, fall back to iOS Data Protection (complete) + Android EncryptedFile and record a new ADR.
