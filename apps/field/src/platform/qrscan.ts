/**
 * Offline QR scanning and the transfer codec.
 *
 * Camera frames go from getUserMedia into a hidden canvas in memory, are
 * decoded with the browser's BarcodeDetector where it exists (Android
 * WebView/Chrome) or jsQR otherwise (iOS WKWebView), and are never saved.
 * The stream is stopped by the returned function; callers stop it on unmount.
 *
 * Native permissions: iOS needs NSCameraUsageDescription in Info.plist;
 * Android needs android.permission.CAMERA in AndroidManifest.xml.
 */
import jsQR from "jsqr";
import type { Codec } from "@pinpoint/core";

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** deflate-raw via the platform's CompressionStream, when available. */
export const browserCodec: Codec | undefined =
  typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined"
    ? {
        compress: (b) => pipe(b, new CompressionStream("deflate-raw")),
        decompress: (b) => pipe(b, new DecompressionStream("deflate-raw")),
      }
    : undefined;

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

async function nativeDetector(): Promise<Detector | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = (await BD.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new BD({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

export interface Scanner {
  stop(): void;
}

/**
 * Start the back camera into `video` and call `onText` for every QR read
 * (repeats included; the caller de-duplicates).
 */
export async function startQrScanner(video: HTMLVideoElement, onText: (text: string) => void): Promise<Scanner> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This phone does not allow camera access here.");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play().catch(() => undefined);

  const detector = await nativeDetector();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  let stopped = false;
  let timer = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (detector) {
          for (const c of await detector.detect(canvas)) if (c.rawValue) onText(c.rawValue);
        } else {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (r?.data) onText(r.data);
        }
      }
    } catch {
      // A bad frame is skipped; the next one is tried.
    }
    if (!stopped) timer = window.setTimeout(tick, 80);
  };
  void tick();

  return {
    stop() {
      stopped = true;
      window.clearTimeout(timer);
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = canvas.height = 0;
    },
  };
}
