import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'sql.js';
import { parseClip, rebuildClip } from '../../src/web/export/clip/container';
import {
  parseTextLayerAttributes,
  patchTextLayerForStringChange,
  patchTextLayerTlv,
  readCanvasBBox,
  estimateVerticalBBox,
  readFontSizeValue,
  utf16CharCount,
  FONT_SIZE_SCALE,
} from '../../src/web/export/clip/textTlv';
import {
  diffSnapshots,
  readOffscreenAttribute,
  readTextLayerBlobs,
  rebuildExternalChunk,
  removeOffscreenFloatCache,
  replaceExtaBody,
  snapshotDb,
  updateTextLayerString,
  writeOffscreenAttribute,
  writeTextLayerBlobs,
  getOffscreenExternalId,
} from './dbHelpers';
import { exportDatabase, openDatabase } from './sqlJsInit';
import {
  encodeColorOffscreen,
  generateE5TestImage,
  rebuildAttribute,
} from '../../src/web/export/clip/raster';
import {
  cloneTextLayer,
  createIdAllocator,
  deleteTextLayer,
  exportTextLayerTemplate,
  normalizeTextLayerBbox,
  pickTextLayerTemplate,
  setCanvasCurrentLayer,
  setLayerSelect,
  stripTextLayerFloatCache,
} from '../../src/web/export/clip/layerOps';
import {
  estimateVerticalTextBBox,
  textLayerPrototypeMainId,
} from '../../src/web/export/clip/textTlv';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE_CLIP = join(ROOT, 'sample', 'export_sample.clip');
const OUT_DIR = join(ROOT, 'sample', '_experiments');

function ensureOutDir(): void {
  mkdirSync(OUT_DIR, { recursive: true });
}

function writeClip(name: string, bytes: Uint8Array): string {
  const path = join(OUT_DIR, name);
  writeFileSync(path, bytes);
  return path;
}

function readTextLayerString(db: Database, mainId: number): string | null {
  const stmt = db.prepare('SELECT TextLayerString FROM Layer WHERE MainId = ?');
  stmt.bind([mainId]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.get();
  stmt.free();
  const val = row[0];
  if (val instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(val);
  }
  return val != null ? String(val) : null;
}

function byteDiffSummary(original: Uint8Array, modified: Uint8Array): Record<string, unknown> {
  const parsedOrig = parseClip(original);
  const parsedMod = parseClip(modified);
  const sqliOrig = parsedOrig.sqliteBytes;
  const sqliMod = parsedMod.sqliteBytes;

  let sqliteDiffCount = 0;
  const sqliteDiffRanges: { offset: number; orig: number; mod: number }[] = [];
  const maxSqli = Math.max(sqliOrig.length, sqliMod.length);
  for (let i = 0; i < maxSqli; i++) {
    const o = i < sqliOrig.length ? sqliOrig[i]! : -1;
    const m = i < sqliMod.length ? sqliMod[i]! : -1;
    if (o !== m) {
      sqliteDiffCount++;
      if (sqliteDiffRanges.length < 20) {
        sqliteDiffRanges.push({ offset: i, orig: o, mod: m });
      }
    }
  }

  let fileDiffCount = 0;
  const fileDiffRanges: { offset: number; orig: number; mod: number }[] = [];
  const maxFile = Math.max(original.length, modified.length);
  for (let i = 0; i < maxFile; i++) {
    const o = i < original.length ? original[i]! : -1;
    const m = i < modified.length ? modified[i]! : -1;
    if (o !== m) {
      fileDiffCount++;
      if (fileDiffRanges.length < 20) {
        fileDiffRanges.push({ offset: i, orig: o, mod: m });
      }
    }
  }

  return {
    originalSize: original.length,
    modifiedSize: modified.length,
    sizeDelta: modified.length - original.length,
    sqliteOriginalSize: sqliOrig.length,
    sqliteModifiedSize: sqliMod.length,
    sqliteSizeDelta: sqliMod.length - sqliOrig.length,
    sqliteByteDiffCount: sqliteDiffCount,
    sqliteByteDiffSample: sqliteDiffRanges,
    fileByteDiffCount: fileDiffCount,
    fileByteDiffSample: fileDiffRanges,
  };
}

async function verifyExternalChunkOffsets(bytes: Uint8Array): Promise<{
  ok: boolean;
  mismatches: { externalId: string; dbOffset: number; actualOffset: number }[];
}> {
  const parsed = parseClip(bytes);
  const db = await openDatabase(parsed.sqliteBytes);
  const rows = db.exec('SELECT ExternalID, Offset FROM ExternalChunk ORDER BY Offset');
  const mismatches: { externalId: string; dbOffset: number; actualOffset: number }[] = [];
  const extaChunks = parsed.chunks.filter((c) => c.name === 'CHNKExta');

  if (rows[0]) {
    for (const row of rows[0].values) {
      const externalId = String(row[0]);
      const dbOffset = Number(row[1]);
      let foundOffset: number | undefined;
      for (let i = 0; i < extaChunks.length; i++) {
        if (parsed.extas[i]?.externalId === externalId) {
          foundOffset = extaChunks[i]!.headerOffset;
          break;
        }
      }
      if (foundOffset !== undefined && foundOffset !== dbOffset) {
        mismatches.push({ externalId, dbOffset, actualOffset: foundOffset });
      }
    }
  }
  db.close();
  return { ok: mismatches.length === 0, mismatches };
}

async function runE0(): Promise<void> {
  ensureOutDir();
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);

  const dbBefore = await openDatabase(parsed.sqliteBytes);
  const snapBefore = snapshotDb(dbBefore);
  dbBefore.close();

  const db = await openDatabase(parsed.sqliteBytes);
  rebuildExternalChunk(db, parsed.extas);
  const snapAfterOpen = snapshotDb(db);
  const sqliteBytes = exportDatabase(db);
  db.close();

  const rebuilt = rebuildClip(parsed, sqliteBytes);
  const outPath = writeClip('E0_roundtrip.clip', rebuilt);

  const diff = byteDiffSummary(original, rebuilt);
  const offsetCheck = await verifyExternalChunkOffsets(rebuilt);

  const report = {
    experiment: 'E0',
    output: outPath,
    dbSnapshotBeforeExport: snapBefore,
    dbSnapshotAfterExternalChunkRebuild: snapAfterOpen,
    dbDiffOpenVsBefore: diffSnapshots(snapBefore, snapAfterOpen),
    sqliteExportDiff: diff,
    externalChunkOffsetCheck: offsetCheck,
  };

  writeFileSync(join(OUT_DIR, 'E0_report.json'), JSON.stringify(report, null, 2));
  console.log('E0 complete:', outPath);
  console.log(JSON.stringify(report, null, 2));
}

async function runE1(): Promise<void> {
  ensureOutDir();
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);

  const variants: { name: string; text: string }[] = [
    { name: 'E1a_samelen.clip', text: 'かきくけこ' },
    { name: 'E1b_shorter.clip', text: 'あい' },
    { name: 'E1c_longer.clip', text: 'あいうえおかきくけこ' },
  ];

  const reports: Record<string, unknown>[] = [];

  for (const variant of variants) {
    const db = await openDatabase(parsed.sqliteBytes);
    updateTextLayerString(db, 5, variant.text);
    rebuildExternalChunk(db, parsed.extas);
    const sqliteBytes = exportDatabase(db);
    const readBack = readTextLayerString(db, 5);
    db.close();

    const rebuilt = rebuildClip(parsed, sqliteBytes);
    const outPath = writeClip(variant.name, rebuilt);
    const offsetCheck = await verifyExternalChunkOffsets(rebuilt);

    reports.push({
      experiment: variant.name,
      output: outPath,
      intendedText: variant.text,
      readBackText: readBack,
      externalChunkOffsetCheck: offsetCheck,
      sqliteSize: sqliteBytes.length,
    });
    console.log(`${variant.name} complete: ${outPath} text=${readBack}`);
  }

  writeFileSync(join(OUT_DIR, 'E1_report.json'), JSON.stringify(reports, null, 2));
}

const LAYER_MAIN_ID = 5;
const FLOAT_CACHE_OFFSCREEN_ID = 31;

async function runE2(): Promise<void> {
  ensureOutDir();
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);

  const variants: {
    name: string;
    apply: (db: Database, blobs: NonNullable<ReturnType<typeof readTextLayerBlobs>>) => {
      text: string;
      extas: typeof parsed.extas;
      meta: Record<string, unknown>;
    };
  }[] = [
    {
      name: 'E2a_len_change_synced.clip',
      apply: (_db, blobs) => {
        const text = 'かきくけこさしすせそ';
        const patched = patchTextLayerForStringChange(
          blobs.attributes,
          blobs.addAttributes,
          text,
        );
        writeTextLayerBlobs(_db, LAYER_MAIN_ID, patched);
        updateTextLayerString(_db, LAYER_MAIN_ID, text);
        const attrParsed = parseTextLayerAttributes(patched.attributes);
        const bbox = readCanvasBBox(
          attrParsed.entries.find((e) => e.paramId === 42)!.payload,
        );
        return {
          text,
          extas: parsed.extas,
          meta: {
            charCount: utf16CharCount(text),
            bbox,
          },
        };
      },
    },
    {
      name: 'E2b_moved.clip',
      apply: (db, blobs) => {
        const text = 'あいうえお';
        const patched = patchTextLayerTlv(blobs.attributes, blobs.addAttributes, {
          positionDelta: { x: -300, y: 400 },
        });
        writeTextLayerBlobs(db, LAYER_MAIN_ID, patched);
        updateTextLayerString(db, LAYER_MAIN_ID, text);
        const bbox = readCanvasBBox(
          parseTextLayerAttributes(patched.attributes).entries.find((e) => e.paramId === 42)!
            .payload,
        );
        return {
          text,
          extas: parsed.extas,
          meta: { bbox, positionDelta: { x: -300, y: 400 } },
        };
      },
    },
    {
      name: 'E2c_fontsize.clip',
      apply: (db, blobs) => {
        const text = 'あいうえお';
        const attrParsed = parseTextLayerAttributes(blobs.attributes);
        const id42 = attrParsed.entries.find((e) => e.paramId === 42)!.payload;
        const current = readCanvasBBox(id42);
        const newFontSizePt = 16;
        const fontSizeValue = Math.round(newFontSizePt * FONT_SIZE_SCALE);
        const bbox = estimateVerticalBBox({
          charCount: utf16CharCount(text),
          fontSizeValue,
          anchorRight: current.right,
          anchorTop: current.top,
        });
        const patched = patchTextLayerTlv(blobs.attributes, blobs.addAttributes, {
          fontSizePt: newFontSizePt,
          bbox,
        });
        writeTextLayerBlobs(db, LAYER_MAIN_ID, patched);
        updateTextLayerString(db, LAYER_MAIN_ID, text);
        return {
          text,
          extas: parsed.extas,
          meta: {
            fontSizePt: newFontSizePt,
            fontSizeValue: Math.round(newFontSizePt * 49.625),
            bbox,
          },
        };
      },
    },
    {
      name: 'E2d_no_cache.clip',
      apply: (db, blobs) => {
        const text = 'かきくけこ';
        const patched = patchTextLayerForStringChange(
          blobs.attributes,
          blobs.addAttributes,
          text,
        );
        const withCache = patchTextLayerTlv(patched.attributes, patched.addAttributes, {
          floatCacheOffscreenId: 0,
        });
        writeTextLayerBlobs(db, LAYER_MAIN_ID, withCache);
        updateTextLayerString(db, LAYER_MAIN_ID, text);
        const extas = removeOffscreenFloatCache(db, parsed, FLOAT_CACHE_OFFSCREEN_ID);
        return {
          text,
          extas,
          meta: {
            charCount: utf16CharCount(text),
            floatCacheOffscreenId: 0,
            removedOffscreenMainId: FLOAT_CACHE_OFFSCREEN_ID,
          },
        };
      },
    },
  ];

  const reports: Record<string, unknown>[] = [];

  for (const variant of variants) {
    const db = await openDatabase(parsed.sqliteBytes);
    const blobs = readTextLayerBlobs(db, LAYER_MAIN_ID);
    if (!blobs) {
      throw new Error(`Layer MainId=${LAYER_MAIN_ID} blobs not found`);
    }
    const result = variant.apply(db, blobs);
    rebuildExternalChunk(db, result.extas);
    const sqliteBytes = exportDatabase(db);
    const readBack = readTextLayerString(db, LAYER_MAIN_ID);
    db.close();

    const rebuiltParsed = { ...parsed, extas: result.extas };
    const rebuilt = rebuildClip(rebuiltParsed, sqliteBytes);
    const outPath = writeClip(variant.name, rebuilt);
    const offsetCheck = await verifyExternalChunkOffsets(rebuilt);

    reports.push({
      experiment: variant.name,
      output: outPath,
      intendedText: result.text,
      readBackText: readBack,
      meta: result.meta,
      externalChunkOffsetCheck: offsetCheck,
      extaCount: result.extas.length,
      sqliteSize: sqliteBytes.length,
    });
    console.log(`${variant.name} complete: ${outPath} text=${readBack}`);
  }

  writeFileSync(join(OUT_DIR, 'E2_report.json'), JSON.stringify(reports, null, 2));
}

async function runE2v2(): Promise<void> {
  ensureOutDir();
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);

  const variants: {
    name: string;
    apply: (db: Database, blobs: NonNullable<ReturnType<typeof readTextLayerBlobs>>) => {
      text: string;
      extas: typeof parsed.extas;
      meta: Record<string, unknown>;
    };
  }[] = [
    {
      name: 'E2a_v2.clip',
      apply: (_db, blobs) => {
        const text = 'かきくけこさしすせそ';
        const patched = patchTextLayerForStringChange(
          blobs.attributes,
          blobs.addAttributes,
          text,
        );
        writeTextLayerBlobs(_db, LAYER_MAIN_ID, patched);
        updateTextLayerString(_db, LAYER_MAIN_ID, text);
        const bbox = readCanvasBBox(
          parseTextLayerAttributes(patched.attributes).entries.find((e) => e.paramId === 42)!
            .payload,
        );
        return {
          text,
          extas: parsed.extas,
          meta: { charCount: utf16CharCount(text), bbox, cspTargetBBox: [918, 509, 951, 839] },
        };
      },
    },
    {
      name: 'E2c_v2.clip',
      apply: (db, blobs) => {
        const text = 'あいうえお';
        const attrParsed = parseTextLayerAttributes(blobs.attributes);
        const current = readCanvasBBox(
          attrParsed.entries.find((e) => e.paramId === 42)!.payload,
        );
        const newFontSizePt = 16;
        const fontSizeValue = Math.round(newFontSizePt * FONT_SIZE_SCALE);
        const bbox = estimateVerticalBBox({
          charCount: utf16CharCount(text),
          fontSizeValue,
          anchorRight: current.right,
          anchorTop: current.top,
        });
        const patched = patchTextLayerTlv(blobs.attributes, blobs.addAttributes, {
          fontSizePt: newFontSizePt,
          bbox,
        });
        writeTextLayerBlobs(db, LAYER_MAIN_ID, patched);
        updateTextLayerString(db, LAYER_MAIN_ID, text);
        return {
          text,
          extas: parsed.extas,
          meta: {
            fontSizePt: newFontSizePt,
            bbox,
            cspTargetBBox: [885, 509, 951, 839],
          },
        };
      },
    },
    {
      name: 'E2d_v2.clip',
      apply: (db, blobs) => {
        const text = 'かきくけこ';
        const patched = patchTextLayerForStringChange(
          blobs.attributes,
          blobs.addAttributes,
          text,
        );
        writeTextLayerBlobs(db, LAYER_MAIN_ID, patched);
        updateTextLayerString(db, LAYER_MAIN_ID, text);
        const bbox = readCanvasBBox(
          parseTextLayerAttributes(patched.attributes).entries.find((e) => e.paramId === 42)!
            .payload,
        );
        return {
          text,
          extas: parsed.extas,
          meta: {
            charCount: utf16CharCount(text),
            bbox,
            floatCacheOffscreenId: FLOAT_CACHE_OFFSCREEN_ID,
            cspTargetBBox: [918, 509, 951, 674],
            note: 'Keeps Offscreen 31; correct 33px/char bbox (no cache deletion)',
          },
        };
      },
    },
  ];

  const reports: Record<string, unknown>[] = [];
  for (const variant of variants) {
    const db = await openDatabase(parsed.sqliteBytes);
    const blobs = readTextLayerBlobs(db, LAYER_MAIN_ID);
    if (!blobs) throw new Error(`Layer MainId=${LAYER_MAIN_ID} blobs not found`);
    const result = variant.apply(db, blobs);
    rebuildExternalChunk(db, result.extas);
    const sqliteBytes = exportDatabase(db);
    const readBack = readTextLayerString(db, LAYER_MAIN_ID);
    db.close();

    const rebuilt = rebuildClip({ ...parsed, extas: result.extas }, sqliteBytes);
    const outPath = writeClip(variant.name, rebuilt);
    const offsetCheck = await verifyExternalChunkOffsets(rebuilt);
    reports.push({
      experiment: variant.name,
      output: outPath,
      intendedText: result.text,
      readBackText: readBack,
      meta: result.meta,
      externalChunkOffsetCheck: offsetCheck,
      sqliteSize: sqliteBytes.length,
    });
    console.log(`${variant.name} complete: ${outPath} text=${readBack}`);
  }
  writeFileSync(join(OUT_DIR, 'E2_v2_report.json'), JSON.stringify(reports, null, 2));
}

const LINEART_LAYER_MAIN_ID = 8;
const LINEART_OFFSCREEN_ID = 48;
const LINEART_WIDTH = 1518;
const LINEART_HEIGHT = 2150;

async function runE5(): Promise<void> {
  ensureOutDir();
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);

  const testRgba = generateE5TestImage(LINEART_WIDTH, LINEART_HEIGHT);
  const encoded = encodeColorOffscreen(testRgba, LINEART_WIDTH, LINEART_HEIGHT);

  const db = await openDatabase(parsed.sqliteBytes);
  const oldAttr = readOffscreenAttribute(db, LINEART_OFFSCREEN_ID);
  if (!oldAttr) {
    throw new Error(`Offscreen MainId=${LINEART_OFFSCREEN_ID} Attribute not found`);
  }

  const externalId = getOffscreenExternalId(db, LINEART_OFFSCREEN_ID);
  if (!externalId) {
    throw new Error(`Offscreen MainId=${LINEART_OFFSCREEN_ID} BlockData external id not found`);
  }

  const newAttr = rebuildAttribute(
    oldAttr,
    LINEART_WIDTH,
    LINEART_HEIGHT,
    encoded.gridW,
    encoded.gridH,
    encoded.blockSizes,
  );
  writeOffscreenAttribute(db, LINEART_OFFSCREEN_ID, newAttr);

  const extas = replaceExtaBody(parsed.extas, externalId, encoded.blockDataBody);
  rebuildExternalChunk(db, extas);
  const sqliteBytes = exportDatabase(db);
  db.close();

  const rebuilt = rebuildClip({ ...parsed, extas }, sqliteBytes);
  const outPath = writeClip('E5_lineart_replaced.clip', rebuilt);
  const offsetCheck = await verifyExternalChunkOffsets(rebuilt);

  const report = {
    experiment: 'E5',
    output: outPath,
    lineartLayerMainId: LINEART_LAYER_MAIN_ID,
    offscreenMainId: LINEART_OFFSCREEN_ID,
    externalId,
    dimensions: { width: LINEART_WIDTH, height: LINEART_HEIGHT },
    grid: { gridW: encoded.gridW, gridH: encoded.gridH },
    blockCount: encoded.blockSizes.length,
    blockSizeTotal: encoded.blockSizes.reduce((a, b) => a + b, 0),
    thumbnailOffscreenId: 49,
    thumbnailLeftStale: true,
    externalChunkOffsetCheck: offsetCheck,
    sqliteSize: sqliteBytes.length,
  };

  writeFileSync(join(OUT_DIR, 'E5_report.json'), JSON.stringify(report, null, 2));
  console.log('E5 complete:', outPath);
  console.log(JSON.stringify(report, null, 2));
}

const TEXT_FOLDER_MAIN_ID = 9;
const LINEART_LAYER_SELECT_ID = 8;

async function runE6(): Promise<void> {
  ensureOutDir();
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);

  const db = await openDatabase(parsed.sqliteBytes);
  let extas = [...parsed.extas];
  const alloc = createIdAllocator(db);

  const deleteReport: Record<string, unknown>[] = [];
  for (const layerId of [6, 7]) {
    const beforeLayers = db.exec('SELECT COUNT(*) FROM Layer')[0]?.values[0]?.[0];
    const result = deleteTextLayer(db, layerId, extas, alloc);
    extas = result.extas;
    deleteReport.push({
      layerMainId: layerId,
      removedOffscreenIds: result.removedOffscreenIds,
      layersBefore: beforeLayers,
      layersAfter: db.exec('SELECT COUNT(*) FROM Layer')[0]?.values[0]?.[0],
    });
  }

  extas = stripTextLayerFloatCache(db, LAYER_MAIN_ID, extas);
  normalizeTextLayerBbox(db, LAYER_MAIN_ID, 'あいうえお', 8);

  const clones: {
    content: string;
    anchorRight: number;
    anchorTop: number;
    fontSizePt: number;
  }[] = [
    { content: 'クローン一号', anchorRight: 1200, anchorTop: 300, fontSizePt: 8 },
    { content: '二行目も\r\nある長文テキスト', anchorRight: 700, anchorTop: 800, fontSizePt: 8 },
    { content: '大きい字', anchorRight: 400, anchorTop: 1400, fontSizePt: 16 },
  ];

  const cloneResults: Record<string, unknown>[] = [];
  for (const spec of clones) {
    const result = cloneTextLayer(
      db,
      LAYER_MAIN_ID,
      TEXT_FOLDER_MAIN_ID,
      spec,
      extas,
      alloc,
      { thumbnailWithExta: false },
    );
    extas = result.extas;
    cloneResults.push({
      newMainId: result.newMainId,
      layerName: result.layerName,
      charCount: utf16CharCount(spec.content),
      anchor: { right: spec.anchorRight, top: spec.anchorTop },
      fontSizePt: spec.fontSizePt,
    });
  }

  setCanvasCurrentLayer(db, LINEART_LAYER_SELECT_ID);
  setLayerSelect(db, LINEART_LAYER_SELECT_ID);

  rebuildExternalChunk(db, extas);
  const sqliteBytes = exportDatabase(db);
  db.close();

  const rebuilt = rebuildClip({ ...parsed, extas }, sqliteBytes);
  const outPath = writeClip('E6_clone.clip', rebuilt);
  const offsetCheck = await verifyExternalChunkOffsets(rebuilt);

  const report = {
    experiment: 'E6',
    output: outPath,
    deletedLayers: deleteReport,
    clones: cloneResults,
    canvasCurrentLayer: LINEART_LAYER_SELECT_ID,
    layerSelect: LINEART_LAYER_SELECT_ID,
    extaCount: extas.length,
    externalChunkOffsetCheck: offsetCheck,
    sqliteSize: sqliteBytes.length,
  };

  writeFileSync(join(OUT_DIR, 'E6_report.json'), JSON.stringify(report, null, 2));
  console.log('E6 complete:', outPath);
  console.log(JSON.stringify(report, null, 2));
}

async function runE6v2(): Promise<void> {
  ensureOutDir();
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);

  const db = await openDatabase(parsed.sqliteBytes);
  let extas = [...parsed.extas];
  const alloc = createIdAllocator(db);

  const templates = new Map<number, ReturnType<typeof exportTextLayerTemplate>>();
  for (const id of [5, 6, 7]) {
    templates.set(id, exportTextLayerTemplate(db, id));
  }

  const deleteReport: Record<string, unknown>[] = [];
  for (const layerId of [6, 7]) {
    const result = deleteTextLayer(db, layerId, extas, alloc);
    extas = result.extas;
    deleteReport.push({
      layerMainId: layerId,
      removedOffscreenIds: result.removedOffscreenIds,
    });
  }

  extas = stripTextLayerFloatCache(db, LAYER_MAIN_ID, extas);
  normalizeTextLayerBbox(db, LAYER_MAIN_ID, 'あいうえお', 8);

  const clones: {
    content: string;
    anchorRight: number;
    anchorTop: number;
    fontSizePt: number;
  }[] = [
    { content: 'クローン一号', anchorRight: 1200, anchorTop: 300, fontSizePt: 8 },
    { content: '二行目も\r\nある長文テキスト', anchorRight: 700, anchorTop: 800, fontSizePt: 8 },
    { content: '大きい字', anchorRight: 400, anchorTop: 1400, fontSizePt: 16 },
    { content: '一行目\r\n二行目\r\n三行目', anchorRight: 900, anchorTop: 1100, fontSizePt: 8 },
  ];

  const cloneResults: Record<string, unknown>[] = [];
  for (const spec of clones) {
    const template = pickTextLayerTemplate(templates, spec.content);
    const prototypeId = textLayerPrototypeMainId(spec.content);
    const fontSizeValue = Math.round(spec.fontSizePt * 49.625);
    const estimated = estimateVerticalTextBBox({
      text: spec.content,
      fontSizeValue,
      anchorRight: spec.anchorRight,
      anchorTop: spec.anchorTop,
    });
    const result = cloneTextLayer(
      db,
      prototypeId,
      TEXT_FOLDER_MAIN_ID,
      spec,
      extas,
      alloc,
      { template, thumbnailWithExta: false },
    );
    extas = result.extas;
    cloneResults.push({
      newMainId: result.newMainId,
      layerName: result.layerName,
      prototypeMainId: prototypeId,
      charCount: utf16CharCount(spec.content),
      lineCount: estimated.metrics.lineCount,
      bbox: {
        left: estimated.left,
        top: estimated.top,
        right: estimated.right,
        bottom: estimated.bottom,
        width: estimated.metrics.width,
        height: estimated.metrics.height,
      },
      anchor: { right: spec.anchorRight, top: spec.anchorTop },
      fontSizePt: spec.fontSizePt,
    });
  }

  setCanvasCurrentLayer(db, LINEART_LAYER_SELECT_ID);
  setLayerSelect(db, LINEART_LAYER_SELECT_ID);

  rebuildExternalChunk(db, extas);
  const sqliteBytes = exportDatabase(db);
  db.close();

  const rebuilt = rebuildClip({ ...parsed, extas }, sqliteBytes);
  const outPath = writeClip('E6_v2.clip', rebuilt);
  const offsetCheck = await verifyExternalChunkOffsets(rebuilt);

  const report = {
    experiment: 'E6_v2',
    output: outPath,
    deletedLayers: deleteReport,
    clones: cloneResults,
    canvasCurrentLayer: LINEART_LAYER_SELECT_ID,
    layerSelect: LINEART_LAYER_SELECT_ID,
    extaCount: extas.length,
    externalChunkOffsetCheck: offsetCheck,
    sqliteSize: sqliteBytes.length,
  };

  writeFileSync(join(OUT_DIR, 'E6_v2_report.json'), JSON.stringify(report, null, 2));
  console.log('E6_v2 complete:', outPath);
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? 'all';
  if (arg === 'e0' || arg === 'all') await runE0();
  if (arg === 'e1' || arg === 'all') await runE1();
  if (arg === 'e2' || arg === 'all') await runE2();
  if (arg === 'e2v2') await runE2v2();
  if (arg === 'e5') await runE5();
  if (arg === 'e6') await runE6();
  if (arg === 'e6v2') await runE6v2();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
