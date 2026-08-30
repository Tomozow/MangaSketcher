/**
 * Browser deps for .clip export (window or DedicatedWorker).
 * sql.js is initialized with an explicit wasm ArrayBuffer so we never rely on
 * instantiateStreaming / sync XHR — both are unreliable in iOS Safari workers.
 */
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import {
  CLIP_CANVAS_HEIGHT,
  CLIP_CANVAS_WIDTH,
  CLIP_SQL_WASM_URL,
  CLIP_TEMPLATE_URL,
} from './exportConstants';

export function clipAssetUrl(path: string, origin = clipAssetOrigin()): string {
  return new URL(path, origin).href;
}

function clipAssetOrigin(): string {
  if (typeof self !== 'undefined' && self.location?.origin && self.location.origin !== 'null') {
    return self.location.origin;
  }
  return 'http://localhost';
}

let sqlPromise: Promise<SqlJsStatic> | null = null;
export function loadSqlJs(): Promise<SqlJsStatic> {
  sqlPromise ??= (async () => {
    const wasmUrl = clipAssetUrl(CLIP_SQL_WASM_URL);
    const res = await fetch(wasmUrl);
    if (!res.ok) {
      throw new Error(`sql wasm fetch failed: ${res.status}`);
    }
    const wasmBinary = new Uint8Array(await res.arrayBuffer());
    return initSqlJs({ wasmBinary, locateFile: () => wasmUrl });
  })();
  return sqlPromise;
}

let templatePromise: Promise<Uint8Array> | null = null;
export function loadClipTemplate(): Promise<Uint8Array> {
  templatePromise ??= fetch(clipAssetUrl(CLIP_TEMPLATE_URL)).then(async (res) => {
    if (!res.ok) {
      throw new Error(`template fetch failed: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  });
  return templatePromise;
}

let scaleCtx: OffscreenCanvasRenderingContext2D | null = null;
function getScaleContext(): OffscreenCanvasRenderingContext2D {
  if (!scaleCtx) {
    const canvas = new OffscreenCanvas(CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
    scaleCtx = canvas.getContext('2d', { willReadFrequently: true });
    if (!scaleCtx) {
      throw new Error('OffscreenCanvas 2d context unavailable');
    }
  }
  return scaleCtx;
}

/** Ink PNG (page raster size) → CLIP canvas RGBA via scaled drawImage. */
export async function decodeInkPngToClipRgba(png: ArrayBuffer): Promise<Uint8Array | null> {
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  try {
    const ctx = getScaleContext();
    ctx.clearRect(0, 0, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
    const image = ctx.getImageData(0, 0, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
    return new Uint8Array(image.data);
  } finally {
    bitmap.close();
  }
}
