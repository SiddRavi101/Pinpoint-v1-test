/**
 * Clean up a phone photo of a paper form before OCR: scale so the long side
 * is about 2400 px (OCR misses small print and is slow on huge photos),
 * grayscale, and stretch contrast. A hard black/white threshold is optional:
 * on uneven light it erases faint print, so it is off by default.
 * Everything happens on an in-memory canvas; nothing is saved.
 */

const TARGET_SIDE = 2400;

export interface PreparedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export async function loadImage(file: Blob): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}

/** Otsu's threshold on a 256-bin histogram. */
export function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

export function preprocess(img: ImageBitmap | HTMLImageElement | HTMLCanvasElement, opts: { threshold?: boolean } = {}): PreparedImage {
  const w0 = "width" in img ? img.width : 0;
  const h0 = "height" in img ? img.height : 0;
  const scale = Math.min(3, TARGET_SIDE / Math.max(w0, h0, 1));
  const width = Math.max(1, Math.round(w0 * scale));
  const height = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img as CanvasImageSource, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  const px = data.data;

  // Grayscale and histogram.
  const hist = new Array<number>(256).fill(0);
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!);
    gray[j] = g;
    hist[g]!++;
  }
  // Contrast stretch between the 1st and 99th percentiles.
  const n = width * height;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++) if ((acc += hist[i]!) >= n * 0.01) { lo = i; break; }
  for (let acc = 0, i = 255; i >= 0; i--) if ((acc += hist[i]!) >= n * 0.01) { hi = i; break; }
  const range = Math.max(1, hi - lo);
  const stretched = new Array<number>(256).fill(0);
  for (let j = 0; j < n; j++) {
    const v = Math.max(0, Math.min(255, Math.round(((gray[j]! - lo) * 255) / range)));
    gray[j] = v;
    stretched[v]!++;
  }
  const t = opts.threshold ? otsu(stretched, n) : -1;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = t < 0 ? gray[j]! : gray[j]! > t ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return { canvas, width, height };
}
