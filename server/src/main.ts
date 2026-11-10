/**
 * Entry point. Configure with environment variables:
 *   PORT                     default 8787
 *   PINPOINT_DB              SQLite path, default ./data/pinpoint.db
 *   PINPOINT_DEVICE_TOKENS   "deviceA:token1,deviceB:token2"
 *   PINPOINT_REVIEW_TOKEN    token for the medical director's review list
 *   PINPOINT_ORIGINS         allowed app origins, default capacitor://localhost,http://localhost,http://localhost:5173
 *
 * Run behind HTTPS (a reverse proxy or the host's TLS). Never log bodies.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "./app.js";
import { Store } from "./store.js";

const dbPath = process.env.PINPOINT_DB ?? "./data/pinpoint.db";
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

const deviceTokens = new Map(
  (process.env.PINPOINT_DEVICE_TOKENS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(":") as [string, string]),
);
const reviewToken = process.env.PINPOINT_REVIEW_TOKEN ?? "";
if (deviceTokens.size === 0 || reviewToken.length < 16) {
  console.error("Set PINPOINT_DEVICE_TOKENS and a PINPOINT_REVIEW_TOKEN of at least 16 characters.");
  process.exit(1);
}

const app = createApp(new Store(dbPath), {
  deviceTokens,
  reviewToken,
  allowedOrigins: (process.env.PINPOINT_ORIGINS ?? "capacitor://localhost,http://localhost,http://localhost:5173").split(","),
  maxBodyBytes: 1_000_000,
  now: () => new Date(),
  log: (line) => console.log(line),
});
const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`pinpoint server on :${port}`));
