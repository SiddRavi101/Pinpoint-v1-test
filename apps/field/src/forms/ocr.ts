/**
 * Offline OCR for blank paper forms (tesseract.js). The worker, the OCR core
 * and the English model ship inside the app under ocr/ (see
 * vite.forms-assets.ts), so nothing is fetched from a CDN.
 */
import type { PSM, Worker } from "tesseract.js";
import type { OcrLine } from "@pinpoint/core";

export interface OcrProgress {
  status: string;
  /** 0..1 */
  progress: number;
}

/** Absolute URL of a bundled OCR asset, relative to the app page. */
export const ocrAssetUrl = (name = ""): string => new URL(`ocr/${name}`, document.baseURI).href;

async function makeWorker(onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  // Loaded on first scan only, so the OCR library stays out of the main bundle.
  const { createWorker, OEM } = await import("tesseract.js");
  return await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: ocrAssetUrl("worker.min.js"),
    corePath: ocrAssetUrl(""),
    langPath: ocrAssetUrl(""),
    workerBlobURL: false,
    gzip: true,
    // Don't keep a copy of the model in IndexedDB; it ships with the app.
    cacheMethod: "none",
    logger: (m: { status: string; progress: number }) => onProgress?.({ status: m.status, progress: m.progress }),
  });
}

export interface ReadOptions {
  /** Tesseract page segmentation mode. Default: sparse text, which finds scattered form labels best. */
  psm?: PSM;
}

/** Read the printed lines of a form image. */
export async function readFormLines(image: HTMLCanvasElement, onProgress?: (p: OcrProgress) => void, opts: ReadOptions = {}): Promise<OcrLine[]> {
  const worker = await makeWorker(onProgress);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: opts.psm ?? ("11" as PSM) /* PSM.SPARSE_TEXT */, preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
    const lines: OcrLine[] = [];
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs) {
        for (const l of p.lines) {
          lines.push({ text: l.text.replace(/\n$/, ""), bbox: l.bbox, confidence: l.confidence });
        }
      }
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}
