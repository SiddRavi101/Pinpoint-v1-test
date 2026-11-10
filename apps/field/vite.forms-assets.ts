/**
 * Ships the OCR engine with the app so form scanning never touches a CDN.
 * Serves (dev) and emits (build) these under ocr/:
 *   worker.min.js                          tesseract.js worker
 *   tesseract-core-*-lstm.wasm.js          OCR core, one per CPU feature level
 *   eng.traineddata.gz                     English model (LSTM, integer)
 * The app points tesseract at these with workerPath/corePath/langPath.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);

function ocrAssets(): Record<string, string> {
  const tessDir = dirname(require.resolve("tesseract.js/package.json"));
  // The core version tesseract.js itself depends on (may be nested under it).
  const coreDir = dirname(createRequire(join(tessDir, "package.json")).resolve("tesseract.js-core/package.json"));
  const engDir = dirname(require.resolve("@tesseract.js-data/eng/package.json"));
  return {
    "worker.min.js": join(tessDir, "dist", "worker.min.js"),
    "tesseract-core-lstm.wasm.js": join(coreDir, "tesseract-core-lstm.wasm.js"),
    "tesseract-core-simd-lstm.wasm.js": join(coreDir, "tesseract-core-simd-lstm.wasm.js"),
    "tesseract-core-relaxedsimd-lstm.wasm.js": join(coreDir, "tesseract-core-relaxedsimd-lstm.wasm.js"),
    "eng.traineddata.gz": join(engDir, "4.0.0_best_int", "eng.traineddata.gz"),
  };
}

export function formsAssets(): Plugin {
  const files = ocrAssets();
  return {
    name: "pinpoint-forms-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/ocr\/([^?#/]+)/.exec(req.url ?? "");
        const src = m ? files[m[1]!] : undefined;
        if (!src) return next();
        res.setHeader("Content-Type", src.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(src));
      });
    },
    generateBundle() {
      for (const [name, src] of Object.entries(files)) {
        this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: readFileSync(src) });
      }
    },
  };
}
