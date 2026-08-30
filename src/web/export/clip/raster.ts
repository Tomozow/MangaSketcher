/**
 * Offscreen tile encode/decode and Attribute blob rebuilding.
 * Browser-compatible: Uint8Array / DataView only.
 */
import { zlibSync, unzlibSync } from 'fflate';

export const TILE = 256;
const TILE_PIXELS = TILE * TILE;
/** Per-tile raw payload: A plane (1B/px) + BGRx plane (4B/px). */
const RAW_SIZE = TILE_PIXELS * 5;
const BEGIN_LABEL = 'BlockDataBeginChunk';
const END_LABEL = 'BlockDataEndChunk';
const STATUS_LABEL = 'BlockStatus';
const CHECK_LABEL = 'BlockCheckSum';

const BEGIN_LABEL_BYTES = utf16beEncode(BEGIN_LABEL);
const END_LABEL_BYTES = utf16beEncode(END_LABEL);

/** Uint32Array fast paths assume little-endian; big-endian hosts use byte loops. */
const IS_LE = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;

export interface EncodeColorOffscreenResult {
  blockDataBody: Uint8Array;
  blockSizes: number[];
  gridW: number;
  gridH: number;
}

export function ceilTile(n: number): number {
  return n > 0 ? Math.ceil(n / TILE) * TILE : TILE;
}

export function gridFor(w: number, h: number): { paddedW: number; paddedH: number; gridW: number; gridH: number } {
  const paddedW = ceilTile(w > 0 ? w : 0);
  const paddedH = ceilTile(h > 0 ? h : 0);
  const gridW = Math.max(1, paddedW / TILE);
  const gridH = Math.max(1, paddedH / TILE);
  return { paddedW, paddedH, gridW, gridH };
}

function utf16beEncode(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = (c >> 8) & 0xff;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

function utf16beField(name: string): Uint8Array {
  const nameBytes = utf16beEncode(name);
  const out = new Uint8Array(4 + nameBytes.length);
  new DataView(out.buffer).setUint32(0, name.length);
  out.set(nameBytes, 4);
  return out;
}

function concatParts(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function packU32BE(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setUint32(i * 4, values[i]!);
  }
  return out;
}

const ADLER_MOD = 65521;
/** Deferred-modulo chunk size; keeps intermediate sums within int32 range. */
const ADLER_CHUNK = 2048;

/** Advance an Adler-32 state (packed as the final `(b << 16) | a` form) over data[start, end). */
function adler32Update(state: number, data: Uint8Array, start: number, end: number): number {
  let a = state & 0xffff;
  let b = (state >>> 16) & 0xffff;
  let i = start;
  while (i < end) {
    const stop = Math.min(i + ADLER_CHUNK, end);
    for (; i < stop; i++) {
      a += data[i]!;
      b += a;
    }
    a %= ADLER_MOD;
    b %= ADLER_MOD;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib Adler-32 over arbitrary bytes. */
export function adler32(data: Uint8Array): number {
  return adler32Update(1, data, 0, data.length);
}

export function parseAttributeParam(attr: Uint8Array): number[] {
  if (attr.length < 118) {
    throw new Error('Offscreen.Attribute too short');
  }
  const initMarker = utf16beEncode('InitColor');
  const initAt = findSubarray(attr, initMarker, 0);
  if (initAt < 42) {
    throw new Error('InitColor missing in Offscreen.Attribute');
  }
  const bodyOff = 38;
  if (initAt - 4 - bodyOff < 80) {
    throw new Error('Parameter body too short');
  }
  const params: number[] = [];
  const view = new DataView(attr.buffer, attr.byteOffset, attr.byteLength);
  for (let i = 0; i < 20; i++) {
    params.push(view.getUint32(bodyOff + i * 4));
  }
  return params;
}

export function rebuildAttribute(
  oldAttribute: Uint8Array,
  width: number,
  height: number,
  gridW: number,
  gridH: number,
  blockSizes: number[],
): Uint8Array {
  const param = parseAttributeParam(oldAttribute);
  param[0] = width;
  param[1] = height;
  param[2] = gridW;
  param[3] = gridH;

  const paramSec = concatParts([utf16beField('Parameter'), packU32BE(param)]);

  const initMarker = utf16beEncode('InitColor');
  const blkMarker = utf16beEncode('BlockSize');
  const initAt = findSubarray(oldAttribute, initMarker, 0);
  const blkAt = findSubarray(oldAttribute, blkMarker, 0);
  if (initAt < 0 || blkAt < 0) {
    throw new Error('Attribute missing InitColor/BlockSize');
  }

  const initPayload = oldAttribute.subarray(initAt + initMarker.length, blkAt - 4);
  const initSec = concatParts([utf16beField('InitColor'), initPayload]);

  const bsPayload = concatParts([
    packU32BE([12, blockSizes.length, 4]),
    packU32BE(blockSizes),
  ]);
  const bsSec = concatParts([utf16beField('BlockSize'), bsPayload]);

  const hdr = packU32BE([16, paramSec.length, initSec.length, bsSec.length]);
  return concatParts([hdr, paramSec, initSec, bsSec]);
}

function findSubarray(buf: Uint8Array, needle: Uint8Array, start = 0): number {
  const n = needle.length;
  if (n === 0) return start;
  const first = needle[0]!;
  const limit = buf.length - n;
  for (let i = start; i <= limit; i++) {
    if (buf[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < n; j++) {
      if (buf[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function labeledU32Array(name: string, values: number[]): Uint8Array {
  const payload = concatParts([packU32BE([12, values.length, 4]), packU32BE(values)]);
  return concatParts([utf16beField(name), payload]);
}

/** Fixed per-block bytes surrounding the zlib payload: 74B header + 38B trailer. */
const BLOCK_OVERHEAD = 112;
const BLOCK_PRE_SIZE = 74;
const BLOCK_TRAILER = concatParts([packU32BE([END_LABEL.length]), END_LABEL_BYTES]);

function buildBlockPre(index: number, inner: number): Uint8Array {
  const pre = new Uint8Array(BLOCK_PRE_SIZE);
  const view = new DataView(pre.buffer);
  view.setUint32(0, BLOCK_OVERHEAD + inner); // block total incl. this length field
  view.setUint32(4, BEGIN_LABEL.length);
  pre.set(BEGIN_LABEL_BYTES, 8);
  view.setUint32(46, index);
  view.setUint32(50, RAW_SIZE);
  view.setUint32(54, TILE);
  view.setUint32(58, TILE);
  view.setUint32(62, 1);
  view.setUint32(66, inner + 4);
  view.setUint32(70, inner, true);
  return pre;
}

const checksumPrefixScratch = new Uint8Array(4);

/** Adler-32 over [inner u32LE][z] without concatenating. */
function blockChecksum(inner: number, z: Uint8Array): number {
  checksumPrefixScratch[0] = inner & 0xff;
  checksumPrefixScratch[1] = (inner >>> 8) & 0xff;
  checksumPrefixScratch[2] = (inner >>> 16) & 0xff;
  checksumPrefixScratch[3] = (inner >>> 24) & 0xff;
  const state = adler32Update(1, checksumPrefixScratch, 0, 4);
  return adler32Update(state, z, 0, z.length);
}

interface EncodedTile {
  z: Uint8Array;
  checksum: number;
}

/**
 * Compressed uniform tiles keyed by their RGBA pixel value (LE u32). Manga pages are
 * dominated by all-white / all-transparent tiles, and the cache persists across pages,
 * so each distinct fill color is compressed only once per session.
 */
const uniformTileCache = new Map<number, EncodedTile>();
const UNIFORM_CACHE_LIMIT = 16;

function encodeUniformTile(pixel: number): EncodedTile {
  const cached = uniformTileCache.get(pixel);
  if (cached) return cached;

  const raw = new Uint8Array(RAW_SIZE);
  const a = pixel >>> 24;
  if (a) raw.fill(a, 0, TILE_PIXELS);
  const bgrx = ((pixel >>> 16) & 0xff) | (pixel & 0xff00) | ((pixel & 0xff) << 16);
  if (bgrx) {
    new Uint32Array(raw.buffer, TILE_PIXELS, TILE_PIXELS).fill(bgrx);
  }

  const z = zlibSync(raw, { level: 1 });
  const entry: EncodedTile = { z, checksum: blockChecksum(z.length, z) };
  if (uniformTileCache.size >= UNIFORM_CACHE_LIMIT) {
    const oldest = uniformTileCache.keys().next().value;
    if (oldest !== undefined) uniformTileCache.delete(oldest);
  }
  uniformTileCache.set(pixel, entry);
  return entry;
}

/** Returns the uniform RGBA pixel value of the covered tile region, or -1 if mixed. */
function scanUniform(
  src32: Uint32Array,
  width: number,
  tileX: number,
  tileY: number,
  covW: number,
  covH: number,
): number {
  if (covW <= 0 || covH <= 0) return 0;
  const v0 = src32[tileY * width + tileX]! >>> 0;
  for (let y = 0; y < covH; y++) {
    let off = (tileY + y) * width + tileX;
    const end = off + covW;
    for (; off < end; off++) {
      if (src32[off] !== v0) return -1;
    }
  }
  return v0;
}

function extractTileLE(
  src32: Uint32Array,
  width: number,
  tileX: number,
  tileY: number,
  covW: number,
  covH: number,
  raw: Uint8Array,
  raw32: Uint32Array,
): void {
  for (let y = 0; y < covH; y++) {
    let srcOff = (tileY + y) * width + tileX;
    let dst = y * TILE;
    const dstEnd = dst + covW;
    for (; dst < dstEnd; dst++, srcOff++) {
      const v = src32[srcOff]!;
      raw[dst] = v >>> 24;
      raw32[dst] = ((v >>> 16) & 0xff) | (v & 0xff00) | ((v & 0xff) << 16);
    }
  }
}

function extractTileBytes(
  src8: Uint8Array,
  width: number,
  tileX: number,
  tileY: number,
  covW: number,
  covH: number,
  raw: Uint8Array,
): void {
  for (let y = 0; y < covH; y++) {
    const rowOff = ((tileY + y) * width + tileX) * 4;
    const dstRow = y * TILE;
    for (let x = 0; x < covW; x++) {
      const s = rowOff + x * 4;
      const d = dstRow + x;
      raw[d] = src8[s + 3]!;
      const q = TILE_PIXELS + d * 4;
      raw[q] = src8[s + 2]!;
      raw[q + 1] = src8[s + 1]!;
      raw[q + 2] = src8[s]!;
      raw[q + 3] = 0;
    }
  }
}

export function encodeColorOffscreen(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): EncodeColorOffscreenResult {
  const { gridW, gridH } = gridFor(width, height);

  let src8: Uint8Array =
    rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  let src32: Uint32Array | null = null;
  if (IS_LE) {
    if ((src8.byteOffset & 3) !== 0) {
      src8 = src8.slice();
    }
    src32 = new Uint32Array(src8.buffer, src8.byteOffset, src8.byteLength >>> 2);
  }

  const parts: Uint8Array[] = [];
  const checksums: number[] = [];
  const blockSizes: number[] = [];
  const rawScratch = new Uint8Array(RAW_SIZE);
  const rawScratch32 = IS_LE ? new Uint32Array(rawScratch.buffer, TILE_PIXELS, TILE_PIXELS) : null;

  for (let ty = 0; ty < gridH; ty++) {
    const tileY = ty * TILE;
    const covH = Math.min(TILE, Math.max(0, height - tileY));
    for (let tx = 0; tx < gridW; tx++) {
      const tileX = tx * TILE;
      const covW = Math.min(TILE, Math.max(0, width - tileX));
      const index = ty * gridW + tx;
      const full = covW === TILE && covH === TILE;

      let tile: EncodedTile | null = null;
      if (src32) {
        const pixel = scanUniform(src32, width, tileX, tileY, covW, covH);
        // Partial tiles are zero-padded, so only a uniform value of 0 stays uniform.
        if (pixel >= 0 && (full || pixel === 0)) {
          tile = encodeUniformTile(pixel);
        }
      }
      if (!tile) {
        if (!full) rawScratch.fill(0);
        if (src32 && rawScratch32) {
          extractTileLE(src32, width, tileX, tileY, covW, covH, rawScratch, rawScratch32);
        } else {
          extractTileBytes(src8, width, tileX, tileY, covW, covH, rawScratch);
        }
        const z = zlibSync(rawScratch, { level: 1 });
        tile = { z, checksum: blockChecksum(z.length, z) };
      }

      parts.push(buildBlockPre(index, tile.z.length), tile.z, BLOCK_TRAILER);
      checksums.push(tile.checksum);
      blockSizes.push(BLOCK_OVERHEAD + tile.z.length);
    }
  }

  parts.push(
    labeledU32Array(STATUS_LABEL, checksums.map(() => 1)),
    labeledU32Array(CHECK_LABEL, checksums),
  );

  return {
    blockDataBody: concatParts(parts),
    blockSizes,
    gridW,
    gridH,
  };
}

function placeTile(
  raw: Uint8Array,
  canvas: Uint8Array,
  canvas32: Uint32Array | null,
  paddedW: number,
  tx: number,
  ty: number,
): void {
  const baseX = tx * TILE;
  const baseY = ty * TILE;

  if (canvas32 && (raw.byteOffset & 3) === 0) {
    const raw32 = new Uint32Array(raw.buffer, raw.byteOffset + TILE_PIXELS, TILE_PIXELS);
    for (let y = 0; y < TILE; y++) {
      let dst = (baseY + y) * paddedW + baseX;
      let s = y * TILE;
      const rowEnd = s + TILE;
      for (; s < rowEnd; s++, dst++) {
        const w = raw32[s]!;
        canvas32[dst] = (raw[s]! << 24) | ((w & 0xff) << 16) | (w & 0xff00) | ((w >>> 16) & 0xff);
      }
    }
    return;
  }

  for (let y = 0; y < TILE; y++) {
    let dstOff = ((baseY + y) * paddedW + baseX) * 4;
    let s = y * TILE;
    const rowEnd = s + TILE;
    for (; s < rowEnd; s++, dstOff += 4) {
      const bOff = TILE_PIXELS + s * 4;
      canvas[dstOff] = raw[bOff + 2]!;
      canvas[dstOff + 1] = raw[bOff + 1]!;
      canvas[dstOff + 2] = raw[bOff]!;
      canvas[dstOff + 3] = raw[s]!;
    }
  }
}

export function decodeColorOffscreen(
  body: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const { paddedW, paddedH, gridW } = gridFor(width, height);
  const canvas = new Uint8Array(paddedW * paddedH * 4);
  const canvas32 = IS_LE ? new Uint32Array(canvas.buffer) : null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let p = 0;

  while (true) {
    const i = findSubarray(body, BEGIN_LABEL_BYTES, p);
    if (i < 0) break;

    const q = i + BEGIN_LABEL_BYTES.length;
    const flag = view.getUint32(q + 16);
    if (flag) {
      const inner = view.getUint32(q + 24, true);
      const zlibOff = q + 28;
      const z = body.subarray(zlibOff, zlibOff + inner);
      const raw = unzlibSync(z);
      if (raw.length >= RAW_SIZE) {
        const idx = view.getUint32(q);
        const ty = Math.floor(idx / gridW);
        const tx = idx % gridW;
        if ((tx + 1) * TILE <= paddedW && (ty + 1) * TILE <= paddedH) {
          placeTile(raw, canvas, canvas32, paddedW, tx, ty);
        }
      }
      p = zlibOff + inner;
    } else {
      p = q;
    }
  }

  const out = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  const paddedRowBytes = paddedW * 4;
  for (let y = 0; y < height; y++) {
    const srcOff = y * paddedRowBytes;
    out.set(canvas.subarray(srcOff, srcOff + rowBytes), y * rowBytes);
  }
  return out;
}

/** Procedural E5 test image: transparent bg, diagonals, circle, semi-transparent gray rect. */
export function generateE5TestImage(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);

  function setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  }

  function drawThickLine(x0: number, y0: number, x1: number, y1: number, thickness: number): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      for (let dy = -thickness; dy <= thickness; dy++) {
        for (let dx = -thickness; dx <= thickness; dx++) {
          if (dx * dx + dy * dy <= thickness * thickness) {
            setPixel(x + dx, y + dy, 0, 0, 0, 255);
          }
        }
      }
    }
  }

  drawThickLine(0, 0, width - 1, height - 1, 2);
  drawThickLine(0, height - 1, width - 1, 0, 2);

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.3;
  const r2 = radius * radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        setPixel(x, y, 0, 0, 0, 255);
      }
    }
  }

  const rectLeft = Math.floor(width * 0.15);
  const rectTop = Math.floor(height * 0.55);
  const rectRight = Math.floor(width * 0.45);
  const rectBottom = Math.floor(height * 0.85);
  for (let y = rectTop; y <= rectBottom; y++) {
    for (let x = rectLeft; x <= rectRight; x++) {
      setPixel(x, y, 128, 128, 128, 128);
    }
  }

  return rgba;
}
