/**
 * CanvasPreview PNG for CSP / Explorer thumbnails.
 * Composites page_template + line art (+ text when OffscreenCanvas is available).
 */
import { zlibSync, unzlibSync } from 'fflate';
import type { Database } from 'sql.js';
import type { Rect } from '../../../domain/types';
import { drawPageTextsOnThumb } from '../../ink/drawPageTextsOnThumb';
import { getOffscreenExternalId } from './clipDb';
import type { ClipExta } from './container';
import {
  CLIP_CANVAS_HEIGHT,
  CLIP_CANVAS_WIDTH,
  CLIP_PAGE_TEMPLATE_OFFSCREEN_ID,
} from './exportConstants';
import { decodeColorOffscreen } from './raster';

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32BE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  writeU32BE(view, 0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcSrc = out.subarray(4, 8 + data.length);
  writeU32BE(view, 8 + data.length, crc32(crcSrc));
  return out;
}

/** Unfiltered RGBA PNG (8-bit). Used for CanvasPreview so Node and the Worker share an encoder. */
export function encodeRgbaPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error(`RGBA length ${rgba.length} does not match ${width}x${height}`);
  }
  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const dst = y * (1 + stride);
    raw[dst] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), dst + 1);
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  writeU32BE(ihdrView, 0, width);
  writeU32BE(ihdrView, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlibSync(raw, { level: 6 });
  const parts = [PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function decodeRgbaPng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  if (png.length < 8 || PNG_SIG.some((b, i) => png[i] !== b)) {
    throw new Error('not a PNG');
  }
  let width = 0;
  let height = 0;
  const idatParts: Uint8Array[] = [];
  let off = 8;
  while (off + 12 <= png.length) {
    const view = new DataView(png.buffer, png.byteOffset + off, png.byteLength - off);
    const len = view.getUint32(0);
    const type = String.fromCharCode(png[off + 4]!, png[off + 5]!, png[off + 6]!, png[off + 7]!);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(8);
      height = view.getUint32(12);
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const idatLen = idatParts.reduce((n, p) => n + p.length, 0);
  const idat = new Uint8Array(idatLen);
  let woff = 0;
  for (const p of idatParts) {
    idat.set(p, woff);
    woff += p.length;
  }
  const raw = unzlibSync(idat);
  const stride = width * 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (1 + stride);
    if (raw[row] !== 0) {
      throw new Error(`unsupported PNG filter ${raw[row]}`);
    }
    rgba.set(raw.subarray(row + 1, row + 1 + stride), y * stride);
  }
  return { width, height, rgba };
}

/** Porter-Duff source-over. Mutates `dst`. */
export function alphaOverRgba(dst: Uint8Array, src: Uint8Array): void {
  const n = Math.min(dst.length, src.length);
  for (let i = 0; i < n; i += 4) {
    const sa = src[i + 3]! / 255;
    if (sa <= 0) continue;
    if (sa >= 1) {
      dst[i] = src[i]!;
      dst[i + 1] = src[i + 1]!;
      dst[i + 2] = src[i + 2]!;
      dst[i + 3] = 255;
      continue;
    }
    const da = dst[i + 3]! / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) continue;
    dst[i] = Math.round((src[i]! * sa + dst[i]! * da * (1 - sa)) / outA);
    dst[i + 1] = Math.round((src[i + 1]! * sa + dst[i + 1]! * da * (1 - sa)) / outA);
    dst[i + 2] = Math.round((src[i + 2]! * sa + dst[i + 2]! * da * (1 - sa)) / outA);
    dst[i + 3] = Math.round(outA * 255);
  }
}

export function readPageTemplateRgba(db: Database, extas: ClipExta[]): Uint8Array {
  const eid = getOffscreenExternalId(db, CLIP_PAGE_TEMPLATE_OFFSCREEN_ID);
  if (!eid) {
    throw new Error('page_template Offscreen external id missing');
  }
  const body = extas.find((e) => e.externalId === eid)?.body;
  if (!body) {
    throw new Error(`page_template Exta missing for ${eid}`);
  }
  return decodeColorOffscreen(body, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
}

export function writeCanvasPreview(
  db: Database,
  png: Uint8Array,
  width = CLIP_CANVAS_WIDTH,
  height = CLIP_CANVAS_HEIGHT,
): void {
  db.run(
    'UPDATE CanvasPreview SET ImageType = 1, ImageWidth = ?, ImageHeight = ?, ImageData = ? WHERE MainId = 1',
    [width, height, png],
  );
}

export function compositePreviewRgba(
  templateRgba: Uint8Array,
  lineartRgba: Uint8Array | null,
): Uint8Array {
  const composed = new Uint8Array(templateRgba);
  if (lineartRgba) {
    alphaOverRgba(composed, lineartRgba);
  }
  return composed;
}

type PreviewText = { content: string; box: Rect; fontSize: number; writingMode?: import('../../../domain/types').WritingMode };

let previewCtx: OffscreenCanvasRenderingContext2D | null | undefined;

function getPreviewContext(): OffscreenCanvasRenderingContext2D | null {
  if (previewCtx !== undefined) return previewCtx;
  if (typeof OffscreenCanvas === 'undefined') {
    previewCtx = null;
    return null;
  }
  const canvas = new OffscreenCanvas(CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  previewCtx = ctx;
  return ctx;
}

function paintPreviewTexts(rgba: Uint8Array, texts: readonly PreviewText[], rasterWidth: number, rasterHeight: number): void {
  const ctx = getPreviewContext();
  if (!ctx || texts.length === 0) return;
  const clamped = new Uint8ClampedArray(rgba);
  ctx.putImageData(new ImageData(clamped, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT), 0, 0);
  drawPageTextsOnThumb(
    ctx,
    texts.map((t) => ({ ...t, color: '#1A1A1A' })),
    rasterWidth,
    rasterHeight,
    CLIP_CANVAS_WIDTH,
    CLIP_CANVAS_HEIGHT,
  );
  const painted = ctx.getImageData(0, 0, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
  rgba.set(painted.data);
}

export function rasterizeCanvasPreviewPng(input: {
  templateRgba: Uint8Array;
  lineartRgba: Uint8Array | null;
  texts: readonly PreviewText[];
  rasterWidth: number;
  rasterHeight: number;
}): Uint8Array {
  const rgba = compositePreviewRgba(input.templateRgba, input.lineartRgba);
  paintPreviewTexts(rgba, input.texts, input.rasterWidth, input.rasterHeight);
  return encodeRgbaPng(rgba, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
}
