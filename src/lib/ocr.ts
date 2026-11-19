// Reads text from camera frames with Tesseract, served from the site (see vite.config.ts).
import type { Worker as OcrWorker } from "tesseract.js";

declare const __OCR_DIR__: string;

export type Progress = (status: string, progress: number) => void;

let worker: Promise<OcrWorker> | null = null;
let listener: Progress | null = null;

/** Starts the text reader (downloads about 7 MB the first time, then it's cached). */
export function startReader(onProgress?: Progress): Promise<OcrWorker> {
  listener = onProgress || null;
  worker ??= (async () => {
    const { createWorker, OEM } = await import("tesseract.js");
    const dir = new URL(`${__OCR_DIR__}/`, document.baseURI).href;
    const w = await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: dir + "worker.min.js",
      corePath: dir,
      langPath: dir.replace(/\/$/, ""),
      workerBlobURL: false,
      logger: (m) => listener?.(m.status, m.progress),
    });
    return w;
  })();
  worker.catch(() => { worker = null; });
  return worker;
}

export async function stopReader() {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate().catch(() => {});
}

const PSM = { line: "7", block: "6", sparse: "11" } as const;

/** One line of text, a block of lines, or scattered bits of text (Tesseract's PSM 7, 6 and 11). */
export async function readText(image: HTMLCanvasElement, mode: keyof typeof PSM): Promise<{ text: string; confidence: number }> {
  const w = await startReader();
  await w.setParameters({ tessedit_pageseg_mode: PSM[mode] as never, user_defined_dpi: "300" });
  const { data } = await w.recognize(image);
  return { text: data.text.trim(), confidence: data.confidence };
}

/**
 * Copies a region of the video into a canvas ready for reading: scaled so the text is a good
 * size, gray, and contrast stretched. `lightText` turns the brightest marks black and the rest
 * white, for the small white print on a card's black border, which Tesseract otherwise merges
 * with the edge of the frame above it.
 */
export function grab(video: HTMLVideoElement, r: { x: number; y: number; w: number; h: number }, height: number,
  canvas = document.createElement("canvas"), lightText = false): HTMLCanvasElement {
  const scale = height / r.h;
  canvas.width = Math.max(1, Math.round(r.w * scale));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const gray = new Uint8ClampedArray(px.length / 4);
  let lo = 255, hi = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    gray[j] = g;
  }
  // Stretch between the 2nd and 98th percentiles, so glare and shadow don't flatten the text.
  const hist = new Uint32Array(256);
  for (const g of gray) hist[g]++;
  const n = gray.length;
  for (let acc = 0, v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  for (let acc = 0, v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * (lightText ? 0.005 : 0.02)) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  const cut = lo + span * 0.72;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = lightText ? (gray[j] >= cut ? 0 : 255) : ((gray[j] - lo) * 255) / span;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
