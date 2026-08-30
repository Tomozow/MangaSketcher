/**
 * Web Worker entry for .clip export. Wires browser deps (fetch, sql.js WASM,
 * OffscreenCanvas PNG decode) into the environment-agnostic ClipExportJob.
 * Bundled by webpack via `new Worker(new URL('./clipExport.worker.ts', import.meta.url))`.
 */
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { ClipExportJob } from './clipExportJob';
import type { ClipWorkerRequest, ClipWorkerResponse } from './clipExportProtocol';
import {
  CLIP_CANVAS_HEIGHT,
  CLIP_CANVAS_WIDTH,
  CLIP_SQL_WASM_URL,
  CLIP_TEMPLATE_URL,
} from './exportConstants';

// tsconfig uses lib "dom" (no "webworker"); type the worker scope minimally.
type WorkerScope = {
  postMessage(message: ClipWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};
const scope = self as unknown as WorkerScope;

let sqlPromise: Promise<SqlJsStatic> | null = null;
function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: () => CLIP_SQL_WASM_URL });
  return sqlPromise;
}

let templatePromise: Promise<Uint8Array> | null = null;
function loadTemplate(): Promise<Uint8Array> {
  templatePromise ??= fetch(CLIP_TEMPLATE_URL).then(async (res) => {
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
async function decodeInkPng(png: ArrayBuffer): Promise<Uint8Array | null> {
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  try {
    const ctx = getScaleContext();
    ctx.clearRect(0, 0, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
    const image = ctx.getImageData(0, 0, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
    return new Uint8Array(image.data.buffer, 0, image.data.length);
  } finally {
    bitmap.close();
  }
}

let job: ClipExportJob | null = null;

scope.onmessage = (event: MessageEvent) => {
  const msg = event.data as ClipWorkerRequest;
  if (msg.type === 'start') {
    job = new ClipExportJob({
      loadSql,
      loadTemplate,
      decodeInkPng,
      post: (message, transfer) => scope.postMessage(message, transfer ?? []),
    });
    void job.run(msg);
    return;
  }
  if (msg.type === 'ink') {
    job?.receiveInk(msg.index, msg.png);
  }
};
