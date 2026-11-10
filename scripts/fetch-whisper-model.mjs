#!/usr/bin/env node
/**
 * Downloads the on-device Whisper model files into apps/field/public/models/
 * so they ship inside the app build (works with no signal from first launch).
 *
 *   npm run fetch-model                     # default: whisper-base.en
 *   npm run fetch-model -- whisper-tiny.en  # lighter model
 *   npm run fetch-model -- --all
 *   npm run fetch-model -- --soft           # warn instead of failing (CI)
 *
 * Idempotent: a file that already exists with the expected size is skipped.
 * Files are written to a .part file first and renamed when complete.
 * Only model files are downloaded. This script never uploads anything.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/field/public/models");
const HOST = process.env.HF_HOST || "https://huggingface.co";
const REVISION = process.env.WHISPER_REVISION || "main";

// Keep in step with apps/field/src/platform/whisper-util.ts (WHISPER_MODELS, REQUIRED_FILES).
const MODELS = {
  "whisper-base.en": "onnx-community/whisper-base.en",
  "whisper-tiny.en": "onnx-community/whisper-tiny.en",
};
const REQUIRED = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
];
// Fetched when present; the tokenizer may ask for these on some versions.
const OPTIONAL = ["special_tokens_map.json", "added_tokens.json", "normalizer.json", "vocab.json", "merges.txt"];

// Ask for uncompressed bodies so byte counts match content-length.
const HEADERS = { "accept-encoding": "identity", "user-agent": "pinpoint-fetch-model" };

const args = process.argv.slice(2);
const soft = args.includes("--soft");
const names = args.includes("--all") ? Object.keys(MODELS) : args.filter((a) => !a.startsWith("--"));
const wanted = names.length ? names : ["whisper-base.en"];

async function headSize(url) {
  const r = await fetch(url, { method: "HEAD", redirect: "follow", headers: HEADERS });
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error(`HEAD ${url}: HTTP ${r.status}`);
  const len = Number(r.headers.get("content-length"));
  return { size: Number.isFinite(len) && len > 0 ? len : null };
}

async function download(repo, file, optional) {
  const url = `${HOST}/${repo}/resolve/${REVISION}/${file}`;
  const dest = join(OUT, repo, file);
  const info = await headSize(url);
  if (info.missing) {
    if (optional) return "absent";
    throw new Error(`${repo}/${file} not found on the model hub`);
  }
  if (existsSync(dest) && (info.size === null || statSync(dest).size === info.size)) return "kept";
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  rmSync(part, { force: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { redirect: "follow", headers: HEADERS });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(part));
      const got = statSync(part).size;
      if (info.size !== null && got !== info.size) throw new Error(`size ${got}, expected ${info.size}`);
      renameSync(part, dest);
      return `downloaded ${(got / 1e6).toFixed(1)} MB`;
    } catch (e) {
      rmSync(part, { force: true });
      if (attempt >= 4) throw new Error(`${repo}/${file}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    }
  }
}

async function main() {
  for (const name of wanted) {
    const repo = MODELS[name];
    if (!repo) throw new Error(`Unknown model "${name}". Choose: ${Object.keys(MODELS).join(", ")}`);
    console.log(`Whisper model ${name} (${repo}) -> apps/field/public/models/${repo}/`);
    for (const f of REQUIRED) console.log(`  ${f}: ${await download(repo, f, false)}`);
    for (const f of OPTIONAL) {
      const r = await download(repo, f, true).catch(() => "skipped");
      if (r !== "absent") console.log(`  ${f}: ${r}`);
    }
  }
}

main().catch((e) => {
  const msg = `fetch-model: ${e.message}`;
  if (soft) {
    console.warn(`WARNING ${msg}\nThe app will build without a bundled voice model; voice falls back to the phone's engine or a one-time download in Settings.`);
    process.exit(0);
  }
  console.error(msg);
  process.exit(1);
});
