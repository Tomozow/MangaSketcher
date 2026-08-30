import type { Database } from 'sql.js';
import type { ClipExta } from '../../src/web/export/clip/container';
import {
  decodeColorOffscreen,
  encodeColorOffscreen,
  rebuildAttribute,
} from '../../src/web/export/clip/raster';
import {
  getOffscreenExternalId,
  readOffscreenAttribute,
  replaceExtaBody,
  writeOffscreenAttribute,
} from '../clip-experiments/dbHelpers';

export const CANVAS_WIDTH = 1518;
export const CANVAS_HEIGHT = 2150;

/**
 * Page-number white-out in page_template pixels (canvas 1518×2150).
 * Covers the baked “1” at ≈(775, 1907). right/bottom are exclusive.
 * Old normalized (0.42, 0.93, 0.16, 0.055) sat on crop marks and missed the digit.
 */
export const PAGE_NUMBER_PIXEL_RECT = {
  left: 760,
  top: 1884,
  right: 792,
  bottom: 1932,
};

export const PAGE_NUMBER_RECT = {
  x: PAGE_NUMBER_PIXEL_RECT.left / CANVAS_WIDTH,
  y: PAGE_NUMBER_PIXEL_RECT.top / CANVAS_HEIGHT,
  w: (PAGE_NUMBER_PIXEL_RECT.right - PAGE_NUMBER_PIXEL_RECT.left) / CANVAS_WIDTH,
  h: (PAGE_NUMBER_PIXEL_RECT.bottom - PAGE_NUMBER_PIXEL_RECT.top) / CANVAS_HEIGHT,
};

export const PAGE_TEMPLATE_LAYER_ID = 3;
export const PAGE_TEMPLATE_OFFSCREEN_ID = 5;
export const LINEART_LAYER_ID = 8;
export const LINEART_OFFSCREEN_ID = 48;
export const TEXT_FOLDER_ID = 9;

export const FORBIDDEN_STRINGS = [
  'あいうえお',
  'こんにちは',
  'さようなら',
  'てすと',
  'クローン',
] as const;

export function pageNumberPixelRect(): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  return { ...PAGE_NUMBER_PIXEL_RECT };
}

/** Remove CHNKExta body for a layer's thumbnail Offscreen; keep DB rows. */
export function removeLayerThumbnailExta(
  db: Database,
  layerMainId: number,
  extas: ClipExta[],
): ClipExta[] {
  const thumbs = db.exec(`SELECT ThumbnailOffscreen FROM LayerThumbnail WHERE LayerId=${layerMainId}`);
  const offId = thumbs[0]?.values[0]?.[0];
  if (!offId) return extas;
  const eid = getOffscreenExternalId(db, Number(offId));
  if (!eid) return extas;
  return extas.filter((e) => e.externalId !== eid);
}

export function replaceOffscreenRgba(
  db: Database,
  offscreenMainId: number,
  rgba: Uint8Array,
  width: number,
  height: number,
  extas: ClipExta[],
): ClipExta[] {
  const oldAttr = readOffscreenAttribute(db, offscreenMainId);
  if (!oldAttr) {
    throw new Error(`Offscreen MainId=${offscreenMainId} Attribute missing`);
  }
  const externalId = getOffscreenExternalId(db, offscreenMainId);
  if (!externalId) {
    throw new Error(`Offscreen MainId=${offscreenMainId} external id missing`);
  }

  const encoded = encodeColorOffscreen(rgba, width, height);
  const newAttr = rebuildAttribute(
    oldAttr,
    width,
    height,
    encoded.gridW,
    encoded.gridH,
    encoded.blockSizes,
  );
  writeOffscreenAttribute(db, offscreenMainId, newAttr);
  return replaceExtaBody(extas, externalId, encoded.blockDataBody);
}

export function transparentRgba(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

export function paintWhiteRect(
  rgba: Uint8Array,
  width: number,
  rect: { left: number; top: number; right: number; bottom: number },
): void {
  for (let y = rect.top; y < rect.bottom; y++) {
    for (let x = rect.left; x < rect.right; x++) {
      if (x < 0 || y < 0 || x >= width) continue;
      const i = (y * width + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = 255;
    }
  }
}

export function decodeOffscreenRgba(
  db: Database,
  offscreenMainId: number,
  extas: ClipExta[],
  width: number,
  height: number,
): Uint8Array {
  const externalId = getOffscreenExternalId(db, offscreenMainId);
  if (!externalId) {
    throw new Error(`Offscreen MainId=${offscreenMainId} external id missing`);
  }
  const body = extas.find((e) => e.externalId === externalId)?.body;
  if (!body) {
    throw new Error(`Exta body missing for ${externalId}`);
  }
  return decodeColorOffscreen(body, width, height);
}

export function setCanvasWorkTime(db: Database, ms: number): void {
  db.run('UPDATE Canvas SET CanvasWorkTime = ? WHERE MainId = 2', [ms]);
}

export function chunkSizeBreakdown(bytes: Uint8Array): Record<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readU64 = (off: number) => {
    const hi = view.getUint32(off);
    const lo = view.getUint32(off + 4);
    return hi * 0x100000000 + lo;
  };
  const firstOff = readU64(16);
  const breakdown: Record<string, number> = { header: firstOff };
  let off = firstOff;
  while (off < bytes.length) {
    const name = String.fromCharCode(...bytes.subarray(off, off + 8)).replace(/\0/g, '');
    const length = readU64(off + 8);
    const key = name || 'unknown';
    breakdown[key] = (breakdown[key] ?? 0) + 16 + length;
    off += 16 + length;
  }
  breakdown.total = bytes.length;
  return breakdown;
}

export function rowToJson(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    if (val instanceof Uint8Array) {
      out[key] = { __b64: Buffer.from(val).toString('base64') };
    } else {
      out[key] = val;
    }
  }
  return out;
}

export function rowsToJson(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(rowToJson);
}

export function jsonToRow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === 'object' && '__b64' in val) {
      out[key] = Buffer.from(String((val as { __b64: string }).__b64), 'base64');
    } else {
      out[key] = val;
    }
  }
  return out;
}
