/**
 * Text layer delete / clone for Clip Studio Paint .clip SQLite databases.
 * Browser-compatible (Uint8Array); used by export pipeline and clip experiments.
 */
import type { Database } from 'sql.js';
import type { ClipExta } from './container';
import {
  estimateVerticalBBox,
  estimateVerticalTextBBox,
  estimateHorizontalTextBBox,
  encodeFontSizeValue,
  getTlvPayload,
  parseTextLayerAttributes,
  patchTextLayerTlv,
  readFontSizeValue,
  textLayerPrototypeMainId,
  utf16CharCount,
} from './textTlv';

const RASTER_TABLES = ['Layer', 'Mipmap', 'MipmapInfo', 'Offscreen', 'LayerThumbnail'] as const;

export class LayerOpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayerOpsError';
  }
}

export interface IdAllocatorState {
  next: Record<string, { mainId: number; pwId: number }>;
}

export function createIdAllocator(db: Database): IdAllocatorState {
  const next: IdAllocatorState['next'] = {};
  for (const table of RASTER_TABLES) {
    const result = db.exec(`SELECT MAX(MainId), MAX(_PW_ID) FROM ${table}`);
    const row = result[0]?.values[0];
    next[table] = {
      mainId: Number(row?.[0] ?? 0),
      pwId: Number(row?.[1] ?? 0),
    };
  }
  return { next };
}

export function allocMainAndPw(alloc: IdAllocatorState, table: string): { mainId: number; pwId: number } {
  const slot = alloc.next[table];
  if (!slot) {
    throw new LayerOpsError(`IdAllocator missing table ${table}`);
  }
  slot.mainId += 1;
  slot.pwId += 1;
  return { mainId: slot.mainId, pwId: slot.pwId };
}

export function syncIdSequences(db: Database, alloc: IdAllocatorState): void {
  for (const table of RASTER_TABLES) {
    const slot = alloc.next[table];
    if (!slot) continue;
    db.run('UPDATE sqlite_sequence SET seq = ? WHERE name = ?', [slot.pwId, table]);
  }
  for (const table of RASTER_TABLES) {
    const slot = alloc.next[table];
    if (!slot) continue;
    db.run('UPDATE ElemScheme SET MaxIndex = ? WHERE TableName = ?', [slot.mainId, table]);
  }
}

export function newLayerUuid(): string {
  const hex = () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  const a = hex() + hex().slice(0, 2);
  return `${a.slice(0, 10)}-${a.slice(10, 14)}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex().slice(0, 12)}`;
}

export function newExternalId(): string {
  const hex = () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0')
      .toUpperCase();
  return `extrnlid${hex()}${hex()}${hex().slice(0, 4)}`;
}

function tableColumns(db: Database, table: string): string[] {
  const result = db.exec(`PRAGMA table_info('${table}')`);
  if (!result[0]) return [];
  return result[0].values.map((row) => String(row[1]));
}

function fetchRow(db: Database, table: string, mainId: number): Record<string, unknown> | null {
  const stmt = db.prepare(`SELECT * FROM ${table} WHERE MainId = ?`);
  stmt.bind([mainId]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const cols = stmt.getColumnNames();
  const vals = stmt.get();
  stmt.free();
  const row: Record<string, unknown> = {};
  for (let i = 0; i < cols.length; i++) {
    row[cols[i]!] = vals[i];
  }
  return row;
}

function fetchRowsByLayerId(db: Database, table: string, layerId: number): Record<string, unknown>[] {
  const result = db.exec(`SELECT * FROM ${table} WHERE LayerId = ${layerId}`);
  if (!result[0]) return [];
  const cols = result[0].columns;
  return result[0].values.map((vals) => {
    const row: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) {
      row[cols[i]!] = vals[i];
    }
    return row;
  });
}

function insertRow(db: Database, table: string, row: Record<string, unknown>): void {
  const cols = tableColumns(db, table);
  const values = cols.map((c) => row[c] ?? null);
  const placeholders = cols.map(() => '?').join(',');
  db.run(`INSERT INTO ${table}(${cols.join(',')}) VALUES (${placeholders})`, values);
}

function decodeBlockDataExternalId(blockData: unknown): string | null {
  if (!(blockData instanceof Uint8Array)) return null;
  return new TextDecoder('ascii').decode(blockData).replace(/\0/g, '').trim();
}

export function getLayerChildren(db: Database, parentMainId: number): number[] {
  const parent = fetchRow(db, 'Layer', parentMainId);
  if (!parent) return [];
  const out: number[] = [];
  let cur = Number(parent.LayerFirstChildIndex ?? 0);
  const seen = new Set<number>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    const row = fetchRow(db, 'Layer', cur);
    if (!row) break;
    cur = Number(row.LayerNextIndex ?? 0);
  }
  return out;
}

export function setLayerChildren(db: Database, parentMainId: number, childIds: number[]): void {
  const first = childIds[0] ?? 0;
  db.run('UPDATE Layer SET LayerFirstChildIndex = ? WHERE MainId = ?', [first, parentMainId]);
  for (let i = 0; i < childIds.length; i++) {
    const nxt = childIds[i + 1] ?? 0;
    db.run(
      'UPDATE Layer SET LayerNextIndex = ?, LayerFirstChildIndex = 0 WHERE MainId = ?',
      [nxt, childIds[i]!],
    );
  }
}

export function appendChildAtTop(db: Database, parentMainId: number, newChildMainId: number): void {
  const children = getLayerChildren(db, parentMainId);
  if (children.length === 0) {
    setLayerChildren(db, parentMainId, [newChildMainId]);
    return;
  }
  const top = children[children.length - 1]!;
  db.run('UPDATE Layer SET LayerNextIndex = ? WHERE MainId = ?', [newChildMainId, top]);
  db.run('UPDATE Layer SET LayerNextIndex = 0, LayerFirstChildIndex = 0 WHERE MainId = ?', [
    newChildMainId,
  ]);
}

function walkMipmapInfoChain(db: Database, firstInfoId: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let cur = firstInfoId;
  const seen = new Set<number>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const info = fetchRow(db, 'MipmapInfo', cur);
    if (!info) break;
    out.push(info);
    cur = Number(info.NextIndex ?? 0);
  }
  return out;
}

function collectLayerOffscreenIds(db: Database, layerMainId: number): number[] {
  const ids = new Set<number>();
  const layer = fetchRow(db, 'Layer', layerMainId);
  if (!layer) return [];

  const renderMip = Number(layer.LayerRenderMipmap ?? 0);
  if (renderMip) {
    const mip = fetchRow(db, 'Mipmap', renderMip);
    if (mip) {
      for (const info of walkMipmapInfoChain(db, Number(mip.BaseMipmapInfo ?? 0))) {
        const offId = Number(info.Offscreen ?? 0);
        if (offId) ids.add(offId);
      }
    }
  }

  for (const thumb of fetchRowsByLayerId(db, 'LayerThumbnail', layerMainId)) {
    const offId = Number(thumb.ThumbnailOffscreen ?? 0);
    if (offId) ids.add(offId);
  }

  const blobs = readTextLayerBlobsFromDb(db, layerMainId);
  if (blobs) {
    try {
      const attr = parseTextLayerAttributes(blobs.attributes);
      const id50 = getTlvPayload(attr.entries, 50);
      if (id50 && id50.length >= 4) {
        const cacheId = new DataView(id50.buffer, id50.byteOffset, id50.byteLength).getUint32(0, true);
        if (cacheId) ids.add(cacheId);
      }
    } catch {
      // non-text or corrupt TLV — skip float cache
    }
  }

  return [...ids];
}

function readTextLayerBlobsFromDb(
  db: Database,
  mainId: number,
): { attributes: Uint8Array; addAttributes: Uint8Array } | null {
  const stmt = db.prepare(
    'SELECT TextLayerAttributes, TextLayerAddAttributesV01 FROM Layer WHERE MainId = ?',
  );
  stmt.bind([mainId]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.get();
  stmt.free();
  const attrs = row[0];
  const add = row[1];
  if (!(attrs instanceof Uint8Array) || !(add instanceof Uint8Array)) return null;
  return { attributes: attrs, addAttributes: add };
}

function removeOffscreenIds(
  db: Database,
  offscreenIds: number[],
  extas: ClipExta[],
): ClipExta[] {
  let result = extas;
  for (const offId of offscreenIds) {
    const row = fetchRow(db, 'Offscreen', offId);
    const eid = row ? decodeBlockDataExternalId(row.BlockData) : null;
    db.run('DELETE FROM Offscreen WHERE MainId = ?', [offId]);
    if (eid) {
      result = result.filter((e) => e.externalId !== eid);
    }
  }
  return result;
}

function unlinkLayerFromParent(db: Database, layerMainId: number): void {
  const layer = fetchRow(db, 'Layer', layerMainId);
  if (!layer) return;

  const stmt = db.prepare(
    'SELECT MainId, LayerFirstChildIndex, LayerNextIndex FROM Layer WHERE LayerFirstChildIndex = ? OR LayerNextIndex = ?',
  );
  stmt.bind([layerMainId, layerMainId]);
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const row: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) {
      row[cols[i]!] = vals[i];
    }
    const pid = Number(row.MainId);
    if (Number(row.LayerFirstChildIndex) === layerMainId) {
      db.run('UPDATE Layer SET LayerFirstChildIndex = ? WHERE MainId = ?', [
        Number(layer.LayerNextIndex ?? 0),
        pid,
      ]);
    }
    if (Number(row.LayerNextIndex) === layerMainId) {
      db.run('UPDATE Layer SET LayerNextIndex = ? WHERE MainId = ?', [
        Number(layer.LayerNextIndex ?? 0),
        pid,
      ]);
    }
  }
  stmt.free();
}

export function layerNameFromContent(content: string): string {
  return content.replace(/\r\n|\r|\n/g, ' ');
}

export interface DeleteTextLayerResult {
  removedOffscreenIds: number[];
  extas: ClipExta[];
}

/** Fully delete a text layer and all owned raster rows (no orphans). */
export function deleteTextLayer(
  db: Database,
  layerMainId: number,
  extas: ClipExta[],
  alloc?: IdAllocatorState,
): DeleteTextLayerResult {
  const layer = fetchRow(db, 'Layer', layerMainId);
  if (!layer) {
    throw new LayerOpsError(`Layer MainId=${layerMainId} not found`);
  }

  unlinkLayerFromParent(db, layerMainId);

  const offscreenIds = collectLayerOffscreenIds(db, layerMainId);
  let updatedExtas = removeOffscreenIds(db, offscreenIds, extas);

  for (const row of fetchRowsByLayerId(db, 'MipmapInfo', layerMainId)) {
    db.run('DELETE FROM MipmapInfo WHERE MainId = ?', [Number(row.MainId)]);
  }
  for (const row of fetchRowsByLayerId(db, 'Mipmap', layerMainId)) {
    db.run('DELETE FROM Mipmap WHERE MainId = ?', [Number(row.MainId)]);
  }
  for (const row of fetchRowsByLayerId(db, 'LayerThumbnail', layerMainId)) {
    db.run('DELETE FROM LayerThumbnail WHERE MainId = ?', [Number(row.MainId)]);
  }

  db.run('DELETE FROM Layer WHERE MainId = ?', [layerMainId]);

  if (alloc) {
    syncIdSequences(db, alloc);
  }

  return { removedOffscreenIds: offscreenIds, extas: updatedExtas };
}

/** Remove float-cache Offscreen referenced by TLV id=50 and set id=50=0. */
export function stripTextLayerFloatCache(
  db: Database,
  layerMainId: number,
  extas: ClipExta[],
): ClipExta[] {
  const blobs = readTextLayerBlobsFromDb(db, layerMainId);
  if (!blobs) {
    throw new LayerOpsError(`Layer MainId=${layerMainId} text blobs missing`);
  }

  const attr = parseTextLayerAttributes(blobs.attributes);
  const id50 = getTlvPayload(attr.entries, 50);
  let cacheOffId = 0;
  if (id50 && id50.length >= 4) {
    cacheOffId = new DataView(id50.buffer, id50.byteOffset, id50.byteLength).getUint32(0, true);
  }

  const patched = patchTextLayerTlv(blobs.attributes, blobs.addAttributes, {
    floatCacheOffscreenId: 0,
  });
  db.run(
    'UPDATE Layer SET TextLayerAttributes = ?, TextLayerAddAttributesV01 = ? WHERE MainId = ?',
    [patched.attributes, patched.addAttributes, layerMainId],
  );

  if (cacheOffId) {
    return removeOffscreenIds(db, [cacheOffId], extas);
  }
  return extas;
}

export interface TextLayerTemplate {
  layer: Record<string, unknown>;
  blobs: { attributes: Uint8Array; addAttributes: Uint8Array };
  mipmapRows: Record<string, unknown>[];
  mipmapInfoRows: Record<string, unknown>[];
  offscreenRows: Record<string, unknown>[];
  thumbnailRows: Record<string, unknown>[];
}

/** Snapshot a text layer (row + blobs + raster chain) before prototype rows are deleted. */
export function exportTextLayerTemplate(db: Database, mainId: number): TextLayerTemplate {
  const layer = fetchRow(db, 'Layer', mainId);
  if (!layer) {
    throw new LayerOpsError(`Template Layer MainId=${mainId} not found`);
  }
  const blobs = readTextLayerBlobsFromDb(db, mainId);
  if (!blobs) {
    throw new LayerOpsError(`Template Layer MainId=${mainId} text blobs missing`);
  }
  return {
    layer,
    blobs,
    mipmapRows: fetchRowsByLayerId(db, 'Mipmap', mainId),
    mipmapInfoRows: fetchRowsByLayerId(db, 'MipmapInfo', mainId),
    offscreenRows: fetchRowsByLayerId(db, 'Offscreen', mainId),
    thumbnailRows: fetchRowsByLayerId(db, 'LayerThumbnail', mainId),
  };
}

export function pickTextLayerTemplate(
  templates: Map<number, TextLayerTemplate>,
  content: string,
): TextLayerTemplate {
  const prototypeId = textLayerPrototypeMainId(content);
  const template = templates.get(prototypeId);
  if (!template) {
    throw new LayerOpsError(`Text layer template MainId=${prototypeId} not loaded`);
  }
  return template;
}

export interface CloneTextLayerParams {
  content: string;
  anchorRight: number;
  anchorTop: number;
  fontSizePt: number;
  writingMode?: 'vertical' | 'horizontal';
  anchorLeft?: number;
  /** Override auto prototype pick (5/6/7 by line count). */
  prototypeMainId?: number;
}
export interface CloneTextLayerResult {
  newMainId: number;
  layerName: string;
  extas: ClipExta[];
}

/**
 * Clone a text-layer prototype with new content/position/size.
 * Pass `template` when prototype rows were deleted from DB (E6 flow).
 */
export function cloneTextLayer(
  db: Database,
  prototypeMainId: number,
  parentFolderMainId: number,
  params: CloneTextLayerParams,
  extas: ClipExta[],
  alloc: IdAllocatorState,
  options?: { thumbnailWithExta?: boolean; template?: TextLayerTemplate },
): CloneTextLayerResult {
  const template = options?.template;
  const src = template?.layer ?? fetchRow(db, 'Layer', prototypeMainId);
  if (!src) {
    throw new LayerOpsError(`Prototype Layer MainId=${prototypeMainId} not found`);
  }

  const { mainId: newLayerId, pwId: newLayerPw } = allocMainAndPw(alloc, 'Layer');
  const content = params.content;
  const charCount = utf16CharCount(content);
  const fontSizeValue = Math.round(params.fontSizePt * 49.625);
  const estimated =
    params.writingMode === 'horizontal'
      ? estimateHorizontalTextBBox({
          text: content,
          fontSizeValue,
          anchorLeft: params.anchorLeft ?? Math.max(0, params.anchorRight),
          anchorTop: params.anchorTop,
        })
      : estimateVerticalTextBBox({
          text: content,
          fontSizeValue,
          anchorRight: params.anchorRight,
          anchorTop: params.anchorTop,
        });

  const srcBlobs = template?.blobs ?? readTextLayerBlobsFromDb(db, prototypeMainId);
  if (!srcBlobs) {
    throw new LayerOpsError(`Prototype MainId=${prototypeMainId} text blobs missing`);
  }

  const patched = patchTextLayerTlv(srcBlobs.attributes, srcBlobs.addAttributes, {
    charCount,
    fontSizePt: params.fontSizePt,
    bbox: estimated,
    multiLine: estimated.metrics.multiLine,
    floatCacheOffscreenId: 0,
    writingMode: params.writingMode === 'horizontal' ? 'horizontal' : 'vertical',
  });

  const layerName = layerNameFromContent(content);
  const textBytes = new TextEncoder().encode(content);

  const oldMips = template?.mipmapRows ?? fetchRowsByLayerId(db, 'Mipmap', prototypeMainId);
  const oldInfos = template?.mipmapInfoRows ?? fetchRowsByLayerId(db, 'MipmapInfo', prototypeMainId);
  const oldThumbs = template?.thumbnailRows ?? fetchRowsByLayerId(db, 'LayerThumbnail', prototypeMainId);

  const neededOffIds = new Set<number>();
  const renderMipId = Number(src.LayerRenderMipmap ?? 0);
  const mipRow = oldMips.find((r) => Number(r.MainId) === renderMipId) ?? oldMips[0];
  const baseInfoId = Number(mipRow?.BaseMipmapInfo ?? 0);

  if (baseInfoId) {
    if (template) {
      let cur = baseInfoId;
      const seen = new Set<number>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const info = oldInfos.find((r) => Number(r.MainId) === cur);
        if (!info) break;
        const offId = Number(info.Offscreen ?? 0);
        if (offId) neededOffIds.add(offId);
        cur = Number(info.NextIndex ?? 0);
      }
    } else {
      for (const info of walkMipmapInfoChain(db, baseInfoId)) {
        const offId = Number(info.Offscreen ?? 0);
        if (offId) neededOffIds.add(offId);
      }
    }
  }

  for (const thumb of oldThumbs) {
    const offId = Number(thumb.ThumbnailOffscreen ?? 0);
    if (offId) neededOffIds.add(offId);
  }

  const protoBlobs = srcBlobs;
  try {
    const protoAttr = parseTextLayerAttributes(protoBlobs.attributes);
    const id50 = getTlvPayload(protoAttr.entries, 50);
    if (id50 && id50.length >= 4) {
      const floatId = new DataView(id50.buffer, id50.byteOffset, id50.byteLength).getUint32(0, true);
      if (floatId) neededOffIds.delete(floatId);
    }
  } catch {
    // ignore
  }

  const allOffs = template?.offscreenRows ?? fetchRowsByLayerId(db, 'Offscreen', prototypeMainId);
  const oldOffs = allOffs.filter((row) => neededOffIds.has(Number(row.MainId)));

  const mipMap = new Map<number, number>();
  const mipPw = new Map<number, number>();
  for (const row of oldMips) {
    const { mainId, pwId } = allocMainAndPw(alloc, 'Mipmap');
    mipMap.set(Number(row.MainId), mainId);
    mipPw.set(mainId, pwId);
  }

  const infoMap = new Map<number, number>();
  const infoPw = new Map<number, number>();
  for (const row of oldInfos) {
    const { mainId, pwId } = allocMainAndPw(alloc, 'MipmapInfo');
    infoMap.set(Number(row.MainId), mainId);
    infoPw.set(mainId, pwId);
  }

  const offMap = new Map<number, number>();
  const offPw = new Map<number, number>();
  for (const row of oldOffs) {
    const { mainId, pwId } = allocMainAndPw(alloc, 'Offscreen');
    offMap.set(Number(row.MainId), mainId);
    offPw.set(mainId, pwId);
  }

  const thumbMap = new Map<number, number>();
  const thumbPw = new Map<number, number>();
  for (const row of oldThumbs) {
    const { mainId, pwId } = allocMainAndPw(alloc, 'LayerThumbnail');
    thumbMap.set(Number(row.MainId), mainId);
    thumbPw.set(mainId, pwId);
  }

  let updatedExtas = extas;

  for (const row of oldOffs) {
    const oldOffId = Number(row.MainId);
    const newOffId = offMap.get(oldOffId)!;
    const newRow = { ...row };
    newRow.MainId = newOffId;
    newRow._PW_ID = offPw.get(newOffId);
    newRow.LayerId = newLayerId;
    const oldEid = decodeBlockDataExternalId(row.BlockData);
    const isThumbOff =
      oldThumbs.some((t) => Number(t.ThumbnailOffscreen) === oldOffId) &&
      !oldInfos.some((i) => Number(i.Offscreen) === oldOffId);
    const newEid = newExternalId();
    const eidBytes = new TextEncoder().encode(newEid);
    const blockBuf = new Uint8Array(40);
    blockBuf.set(eidBytes.subarray(0, Math.min(eidBytes.length, 40)));
    newRow.BlockData = blockBuf;
    if (oldEid && isThumbOff && options?.thumbnailWithExta) {
      const body = updatedExtas.find((e) => e.externalId === oldEid)?.body;
      if (body) {
        updatedExtas = [...updatedExtas, { externalId: newEid, body: new Uint8Array(body) }];
      }
    }
    insertRow(db, 'Offscreen', newRow);
  }

  for (const row of oldInfos) {
    const newId = infoMap.get(Number(row.MainId))!;
    const newRow = { ...row };
    newRow.MainId = newId;
    newRow._PW_ID = infoPw.get(newId);
    newRow.LayerId = newLayerId;
    newRow.Offscreen = offMap.get(Number(row.Offscreen ?? 0)) ?? 0;
    const nxt = Number(row.NextIndex ?? 0);
    newRow.NextIndex = infoMap.get(nxt) ?? 0;
    insertRow(db, 'MipmapInfo', newRow);
  }

  for (const row of oldMips) {
    const newId = mipMap.get(Number(row.MainId))!;
    const newRow = { ...row };
    newRow.MainId = newId;
    newRow._PW_ID = mipPw.get(newId);
    newRow.LayerId = newLayerId;
    newRow.BaseMipmapInfo = infoMap.get(Number(row.BaseMipmapInfo ?? 0)) ?? 0;
    insertRow(db, 'Mipmap', newRow);
  }

  for (const row of oldThumbs) {
    const newId = thumbMap.get(Number(row.MainId))!;
    const newRow = { ...row };
    newRow.MainId = newId;
    newRow._PW_ID = thumbPw.get(newId);
    newRow.LayerId = newLayerId;
    const toff = Number(row.ThumbnailOffscreen ?? 0);
    newRow.ThumbnailOffscreen = offMap.get(toff) ?? toff;
    insertRow(db, 'LayerThumbnail', newRow);
  }

  const newLayer = { ...src };
  newLayer.MainId = newLayerId;
  newLayer._PW_ID = newLayerPw;
  newLayer.LayerName = layerName;
  newLayer.LayerUuid = newLayerUuid();
  newLayer.LayerNextIndex = 0;
  newLayer.LayerFirstChildIndex = 0;
  newLayer.LayerOffsetX = 0;
  newLayer.LayerOffsetY = 0;
  newLayer.LayerRenderOffscrOffsetX = 0;
  newLayer.LayerRenderOffscrOffsetY = 0;
  newLayer.LayerMaskOffsetX = 0;
  newLayer.LayerMaskOffsetY = 0;
  newLayer.LayerMaskOffscrOffsetX = 0;
  newLayer.LayerMaskOffscrOffsetY = 0;
  newLayer.LayerRenderMipmap = mipMap.get(Number(src.LayerRenderMipmap ?? 0)) ?? 0;
  newLayer.LayerRenderThumbnail = thumbMap.get(Number(src.LayerRenderThumbnail ?? 0)) ?? 0;
  newLayer.TextLayerString = textBytes;
  newLayer.TextLayerAttributes = patched.attributes;
  newLayer.TextLayerAddAttributesV01 = patched.addAttributes;
  insertRow(db, 'Layer', newLayer);

  appendChildAtTop(db, parentFolderMainId, newLayerId);
  syncIdSequences(db, alloc);

  return { newMainId: newLayerId, layerName, extas: updatedExtas };
}

/** Normalize layer 5 text TLV bbox for current string + font size (cache-less). */
export function normalizeTextLayerBbox(
  db: Database,
  layerMainId: number,
  content?: string,
  fontSizePt?: number,
): void {
  const blobs = readTextLayerBlobsFromDb(db, layerMainId);
  if (!blobs) {
    throw new LayerOpsError(`Layer MainId=${layerMainId} text blobs missing`);
  }
  const attr = parseTextLayerAttributes(blobs.attributes);
  const id42 = getTlvPayload(attr.entries, 42);
  const id32 = getTlvPayload(attr.entries, 32);
  if (!id42 || !id32) {
    throw new LayerOpsError('id=42/32 missing');
  }

  let text = content;
  if (!text) {
    const stmt = db.prepare('SELECT TextLayerString FROM Layer WHERE MainId = ?');
    stmt.bind([layerMainId]);
    if (!stmt.step()) {
      stmt.free();
      throw new LayerOpsError('TextLayerString missing');
    }
    const val = stmt.get()[0];
    stmt.free();
    text = val instanceof Uint8Array ? new TextDecoder('utf-8').decode(val) : String(val);
  }

  const current = {
    right: new DataView(id42.buffer, id42.byteOffset).getUint32(8, true),
    top: new DataView(id42.buffer, id42.byteOffset + 4).getUint32(0, true),
  };
  const fsValue = fontSizePt != null ? encodeFontSizeValue(fontSizePt) : id32;
  const fontSizeValue =
    fontSizePt != null
      ? new DataView(fsValue.buffer, fsValue.byteOffset).getUint32(0, true)
      : readFontSizeValue(id32);

  const estimated = estimateVerticalTextBBox({
    text: text!,
    fontSizeValue,
    anchorRight: current.right,
    anchorTop: current.top,
  });

  const patch: {
    charCount: number;
    bbox: typeof estimated;
    fontSizePt?: number;
    multiLine: boolean;
  } = {
    charCount: utf16CharCount(text!),
    bbox: estimated,
    multiLine: estimated.metrics.multiLine,
  };
  if (fontSizePt != null) {
    patch.fontSizePt = fontSizePt;
  }

  const patched = patchTextLayerTlv(blobs.attributes, blobs.addAttributes, patch);
  db.run(
    'UPDATE Layer SET TextLayerAttributes = ?, TextLayerAddAttributesV01 = ? WHERE MainId = ?',
    [patched.attributes, patched.addAttributes, layerMainId],
  );
}

export function setCanvasCurrentLayer(db: Database, layerMainId: number): void {
  db.run('UPDATE Canvas SET CanvasCurrentLayer = ? WHERE MainId = 2', [layerMainId]);
}

export function setLayerSelect(db: Database, layerMainId: number): void {
  db.run('UPDATE Layer SET LayerSelect = 0');
  db.run('UPDATE Layer SET LayerSelect = 1 WHERE MainId = ?', [layerMainId]);
}
