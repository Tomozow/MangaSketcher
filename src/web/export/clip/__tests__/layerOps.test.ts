import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import initSqlJs from 'sql.js';
import { parseClip } from '../container';
import {
  cloneTextLayer,
  createIdAllocator,
  deleteTextLayer,
  exportTextLayerTemplate,
  getLayerChildren,
  layerNameFromContent,
  stripTextLayerFloatCache,
} from '../layerOps';
import {
  getTlvPayload,
  parseTextLayerAttributes,
  readCanvasBBox,
  utf16CharCount,
} from '../textTlv';

const SAMPLE_CLIP = join(process.cwd(), 'sample', 'export_sample.clip');
const SAMPLE_SQLITE = join(process.cwd(), 'sample', '_analysis', 'export_sample.sqlite');

async function openSampleDb(): Promise<{
  db: import('sql.js').Database;
  extas: import('../container').ClipExta[];
}> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const bytes = readFileSync(SAMPLE_SQLITE);
  const db = new SQL.Database(bytes);
  const parsed = parseClip(new Uint8Array(readFileSync(SAMPLE_CLIP)));
  return { db, extas: parsed.extas };
}

describe('layerOps', () => {
  test('layerNameFromContent replaces newlines with spaces', () => {
    expect(layerNameFromContent('二行目も\r\nある')).toBe('二行目も ある');
  });

  test('deleteTextLayer removes layer 6 and raster rows without orphans', async () => {
    const { db, extas } = await openSampleDb();
    const alloc = createIdAllocator(db);
    const offBefore = db.exec('SELECT COUNT(*) FROM Offscreen')[0]!.values[0]![0] as number;
    const layerBefore = db.exec('SELECT COUNT(*) FROM Layer')[0]!.values[0]![0] as number;

    const result = deleteTextLayer(db, 6, extas, alloc);
    expect(result.removedOffscreenIds.length).toBeGreaterThan(0);

    const layerAfter = db.exec('SELECT COUNT(*) FROM Layer')[0]!.values[0]![0] as number;
    expect(layerAfter).toBe(layerBefore - 1);

    const offAfter = db.exec('SELECT COUNT(*) FROM Offscreen')[0]!.values[0]![0] as number;
    expect(offAfter).toBe(offBefore - result.removedOffscreenIds.length);

    const missing = db.exec('SELECT MainId FROM Layer WHERE MainId=6');
    expect(missing[0]?.values.length ?? 0).toBe(0);

    const children = getLayerChildren(db, 9);
    expect(children).toEqual([5, 7]);

    const layer5 = db.exec('SELECT LayerNextIndex FROM Layer WHERE MainId=5')[0]!.values[0]![0];
    expect(layer5).toBe(7);

    db.close();
  });

  test('stripTextLayerFloatCache sets id=50=0 and removes offscreen 31', async () => {
    const { db, extas } = await openSampleDb();
    const updated = stripTextLayerFloatCache(db, 5, extas);
    expect(updated.length).toBeLessThan(extas.length);

    const blobs = db.exec(
      'SELECT TextLayerAttributes FROM Layer WHERE MainId=5',
    )[0]!.values[0]![0] as Uint8Array;
    const attr = parseTextLayerAttributes(blobs);
    const id50 = getTlvPayload(attr.entries, 50)!;
    expect(new DataView(id50.buffer, id50.byteOffset).getUint32(0, true)).toBe(0);

    const off31 = db.exec('SELECT MainId FROM Offscreen WHERE MainId=31');
    expect(off31[0]?.values.length ?? 0).toBe(0);
    db.close();
  });

  test('cloneTextLayer allocates ids and builds TLV bbox', async () => {
    const { db, extas } = await openSampleDb();
    const alloc = createIdAllocator(db);
    const maxLayerBefore = db.exec('SELECT MAX(MainId) FROM Layer')[0]!.values[0]![0] as number;

    const result = cloneTextLayer(
      db,
      5,
      9,
      {
        content: 'クローン一号',
        anchorRight: 1200,
        anchorTop: 300,
        fontSizePt: 8,
      },
      extas,
      alloc,
      { thumbnailWithExta: false },
    );

    expect(result.newMainId).toBe(maxLayerBefore + 1);
    expect(result.layerName).toBe('クローン一号');

    const stmt = db.prepare(
      'SELECT TextLayerAttributes, TextLayerString FROM Layer WHERE MainId = ?',
    );
    stmt.bind([result.newMainId]);
    stmt.step();
    const row = stmt.get();
    const attrs = row[0] as Uint8Array;
    const text = new TextDecoder('utf-8').decode(row[1] as Uint8Array);
    stmt.free();
    expect(text).toBe('クローン一号');

    const attr = parseTextLayerAttributes(attrs);
    const bbox = readCanvasBBox(getTlvPayload(attr.entries, 42)!);
    expect(bbox).toEqual({
      left: 1167,
      top: 300,
      right: 1200,
      bottom: 498,
    });
    const id50 = getTlvPayload(attr.entries, 50)!;
    expect(new DataView(id50.buffer, id50.byteOffset).getUint32(0, true)).toBe(0);

    const mipStmt = db.prepare('SELECT COUNT(*) FROM Mipmap WHERE LayerId = ?');
    mipStmt.bind([result.newMainId]);
    mipStmt.step();
    const mipCount = mipStmt.get()[0] as number;
    mipStmt.free();
    expect(mipCount).toBe(1);

    const thumbStmt = db.prepare('SELECT COUNT(*) FROM LayerThumbnail WHERE LayerId = ?');
    thumbStmt.bind([result.newMainId]);
    thumbStmt.step();
    const thumbCount = thumbStmt.get()[0] as number;
    thumbStmt.free();
    expect(thumbCount).toBe(1);

    db.close();
  });

  test('appendChildAtTop adds clone at top of folder children', async () => {
    const { db, extas } = await openSampleDb();
    const alloc = createIdAllocator(db);
    const r1 = cloneTextLayer(
      db,
      5,
      9,
      { content: 'A', anchorRight: 1000, anchorTop: 100, fontSizePt: 8 },
      extas,
      alloc,
    );
    const children = getLayerChildren(db, 9);
    expect(children[children.length - 1]).toBe(r1.newMainId);

    const r2 = cloneTextLayer(
      db,
      5,
      9,
      { content: 'B', anchorRight: 1100, anchorTop: 200, fontSizePt: 8 },
      r1.extas,
      alloc,
    );
    const children2 = getLayerChildren(db, 9);
    expect(children2[children2.length - 1]).toBe(r2.newMainId);
    const prevStmt = db.prepare('SELECT LayerNextIndex FROM Layer WHERE MainId = ?');
    prevStmt.bind([r1.newMainId]);
    prevStmt.step();
    const prev = prevStmt.get()[0];
    prevStmt.free();
    expect(prev).toBe(r2.newMainId);
    db.close();
  });

  test('clone two-line content uses L6 prototype bbox (82×266)', async () => {
    const { db, extas } = await openSampleDb();
    const alloc = createIdAllocator(db);
    const template = exportTextLayerTemplate(db, 6);
    const content = '二行目も\r\nある長文テキスト';

    const result = cloneTextLayer(
      db,
      6,
      9,
      { content, anchorRight: 700, anchorTop: 800, fontSizePt: 8 },
      extas,
      alloc,
      { template },
    );

    const attrStmt = db.prepare('SELECT TextLayerAttributes FROM Layer WHERE MainId = ?');
    attrStmt.bind([result.newMainId]);
    attrStmt.step();
    const attrs = attrStmt.get()[0] as Uint8Array;
    attrStmt.free();
    const attr = parseTextLayerAttributes(attrs);
    const bbox = readCanvasBBox(getTlvPayload(attr.entries, 42)!);
    expect(bbox).toEqual({ left: 618, top: 800, right: 700, bottom: 1066 });
    const id63 = getTlvPayload(attr.entries, 63)!;
    expect(new DataView(id63.buffer, id63.byteOffset).getUint32(0, true)).toBe(82);
    expect(new DataView(id63.buffer, id63.byteOffset).getUint32(4, true)).toBe(266);
    const id72 = getTlvPayload(attr.entries, 72)!;
    expect(new DataView(id72.buffer, id72.byteOffset).getUint32(0, true)).toBe(81);
    db.close();
  });

  test('clone three-line content uses L7 prototype', async () => {
    const { db, extas } = await openSampleDb();
    const alloc = createIdAllocator(db);
    const template = exportTextLayerTemplate(db, 7);
    const content = '一行目\r\n二行目\r\n三行目';

    const result = cloneTextLayer(
      db,
      7,
      9,
      { content, anchorRight: 900, anchorTop: 1100, fontSizePt: 8 },
      extas,
      alloc,
      { template },
    );

    const attrStmt = db.prepare('SELECT TextLayerAttributes FROM Layer WHERE MainId = ?');
    attrStmt.bind([result.newMainId]);
    attrStmt.step();
    const attrs = attrStmt.get()[0] as Uint8Array;
    attrStmt.free();
    const attr = parseTextLayerAttributes(attrs);
    const bbox = readCanvasBBox(getTlvPayload(attr.entries, 42)!);
    expect(bbox.right - bbox.left).toBe(131);
    expect(bbox.bottom - bbox.top).toBe(101);
    db.close();
  });
});
