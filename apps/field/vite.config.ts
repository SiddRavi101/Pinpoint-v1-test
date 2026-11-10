import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));

/** ONNX Runtime files the Whisper worker loads (plain SIMD build, WASM backend). */
const ORT_FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

function ortDist(): string {
  for (let dir = here; ; dir = dirname(dir)) {
    const p = join(dir, "node_modules", "onnxruntime-web", "dist");
    if (existsSync(join(p, ORT_FILES[1]!))) return p;
    if (dirname(dir) === dir) throw new Error("onnxruntime-web not found; run npm install");
  }
}

/**
 * Serves ./ort/* in dev and copies it into the build, so the speech model
 * runtime loads from the app itself (no CDN, works offline).
 */
function localOrt(): Plugin {
  const src = ortDist();
  return {
    name: "pinpoint-local-ort",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/ort\/([^/?#]+)/.exec(req.url ?? "");
        if (!m || !ORT_FILES.includes(m[1]!)) return next();
        res.setHeader("Content-Type", m[1]!.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        res.end(readFileSync(join(src, m[1]!)));
      });
    },
    generateBundle() {
      for (const f of ORT_FILES) this.emitFile({ type: "asset", fileName: `ort/${f}`, source: readFileSync(join(src, f)) });
    },
  };
}

/**
 * ONNX Runtime references its own .wasm builds by URL, so Vite copies them
 * (about 27 MB) even though the worker loads ./ort/ instead. Drop them.
 */
function dropBundledOrtWasm(): Plugin {
  return {
    name: "pinpoint-drop-bundled-ort-wasm",
    generateBundle(_opts, bundle) {
      for (const name of Object.keys(bundle)) if (/^assets\/ort-wasm.*\.(wasm|mjs)$/.test(name)) delete bundle[name];
    },
  };
}

export default defineConfig({
  plugins: [react(), localOrt(), dropBundledOrtWasm()],
  // Relative asset paths so the bundle works inside the native wrapper.
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
    // The speech worker carries the ONNX runtime glue; it's loaded only when voice is used.
    chunkSizeWarningLimit: 2500,
  },
  worker: { format: "es", plugins: () => [dropBundledOrtWasm()] },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  server: { port: 5173 },
});
