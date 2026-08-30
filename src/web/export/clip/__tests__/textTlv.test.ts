import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import initSqlJs from 'sql.js';
import {
  COLUMN_WIDTH_8PT_PX,
  FONT_SIZE_SCALE,
  LINE_PITCH_8PT_PX,
  encodeCacheWidthHint,
  estimateVerticalBBox,
  estimateVerticalTextBBox,
  getTlvPayload,
  parseTextLayerAddAttributes,
  parseTextLayerAttributes,
  patchFullRunVtype,
  patchTextLayerForStringChange,
  patchTextLayerTlv,
  readCanvasBBox,
  readFontSizeValue,
  serializeTextLayerAddAttributes,
  serializeTextLayerAttributes,
  utf16CharCount,
  verticalTextMetrics,
} from '../textTlv';

const SAMPLE_SQLITE = join(process.cwd(), 'sample', '_analysis', 'export_sample.sqlite');

interface LayerBlobs {
  mainId: number;
  attributes: Uint8Array;
  addAttributes: Uint8Array;
  text: string;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function loadTextLayerBlobs(): Promise<LayerBlobs[]> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });
  const db = new SQL.Database(readFileSync(SAMPLE_SQLITE));
  const result = db.exec(
    'SELECT MainId, TextLayerAttributes, TextLayerAddAttributesV01, TextLayerString FROM Layer WHERE TextLayerString IS NOT NULL ORDER BY MainId',
  );
  db.close();
  if (!result[0]) return [];
  return result[0].values.map((row) => ({
    mainId: Number(row[0]),
    attributes: row[1] as Uint8Array,
    addAttributes: row[2] as Uint8Array,
    text: new TextDecoder('utf-8').decode(row[3] as Uint8Array),
  }));
}

describe('textTlv', () => {
  test('parse → serialize roundtrip on all 3 text layers', async () => {
    const layers = await loadTextLayerBlobs();
    expect(layers.length).toBe(3);

    for (const layer of layers) {
      const attr = parseTextLayerAttributes(layer.attributes);
      const add = parseTextLayerAddAttributes(layer.addAttributes);
      const attrOut = serializeTextLayerAttributes(attr);
      const addOut = serializeTextLayerAddAttributes(add);
      expect(bytesEqual(attrOut, layer.attributes)).toBe(true);
      expect(bytesEqual(addOut, layer.addAttributes)).toBe(true);
    }
  });

  test('L5 patch char count and bbox for 10-char string (CSP 33px/char pitch)', async () => {
    const layers = await loadTextLayerBlobs();
    const l5 = layers.find((l) => l.mainId === 5)!;
    const newText = 'かきくけこさしすせそ';
    const patched = patchTextLayerForStringChange(
      l5.attributes,
      l5.addAttributes,
      newText,
    );
    const attr = parseTextLayerAttributes(patched.attributes);
    const id39 = getTlvPayload(attr.entries, 39)!;
    const id11 = getTlvPayload(attr.entries, 11)!;
    expect(utf16CharCount(newText)).toBe(10);
    expect(new DataView(id39.buffer, id39.byteOffset).getUint32(0, true)).toBe(10);
    expect(new DataView(id11.buffer, id11.byteOffset).getUint32(8, true)).toBe(10);
    const bbox = readCanvasBBox(getTlvPayload(attr.entries, 42)!);
    expect(bbox).toEqual({ left: 918, top: 509, right: 951, bottom: 839 });
    const id63 = getTlvPayload(attr.entries, 63)!;
    expect(new DataView(id63.buffer, id63.byteOffset).getUint32(0, true)).toBe(33);
    expect(new DataView(id63.buffer, id63.byteOffset).getUint32(4, true)).toBe(330);
    const id72 = getTlvPayload(attr.entries, 72)!;
    expect(new DataView(id72.buffer, id72.byteOffset).getUint32(0, true)).toBe(33);
  });

  test('L5 position patch translates id=42', async () => {
    const layers = await loadTextLayerBlobs();
    const l5 = layers.find((l) => l.mainId === 5)!;
    const orig = readCanvasBBox(getTlvPayload(parseTextLayerAttributes(l5.attributes).entries, 42)!);
    const patched = patchTextLayerTlv(l5.attributes, l5.addAttributes, {
      positionDelta: { x: -300, y: 400 },
    });
    const bbox = readCanvasBBox(
      getTlvPayload(parseTextLayerAttributes(patched.attributes).entries, 42)!,
    );
    expect(bbox.left).toBe(orig.left - 300);
    expect(bbox.top).toBe(orig.top + 400);
    expect(bbox.right).toBe(orig.right - 300);
    expect(bbox.bottom).toBe(orig.bottom + 400);
  });

  test('L5 font size patch 16pt matches CSP ground-truth bbox', async () => {
    const layers = await loadTextLayerBlobs();
    const l5 = layers.find((l) => l.mainId === 5)!;
    const origAttr = parseTextLayerAttributes(l5.attributes);
    const origBbox = readCanvasBBox(getTlvPayload(origAttr.entries, 42)!);
    const fontSizeValue = Math.round(16 * FONT_SIZE_SCALE);
    const bbox = estimateVerticalBBox({
      charCount: 5,
      fontSizeValue,
      anchorRight: origBbox.right,
      anchorTop: origBbox.top,
    });
    const patched = patchTextLayerTlv(l5.attributes, l5.addAttributes, {
      fontSizePt: 16,
      bbox,
    });
    const attr = parseTextLayerAttributes(patched.attributes);
    expect(readFontSizeValue(getTlvPayload(attr.entries, 32)!)).toBe(fontSizeValue);
    expect(readCanvasBBox(getTlvPayload(attr.entries, 42)!)).toEqual({
      left: 885,
      top: 509,
      right: 951,
      bottom: 839,
    });
    const id72 = getTlvPayload(attr.entries, 72)!;
    expect(new DataView(id72.buffer, id72.byteOffset).getUint32(0, true)).toBe(66);
  });

  test('vertical metrics scale linearly with font size', () => {
    const bbox8 = estimateVerticalBBox({
      charCount: 5,
      fontSizeValue: 397,
      anchorRight: 951,
      anchorTop: 509,
    });
    expect(bbox8.right - bbox8.left).toBe(COLUMN_WIDTH_8PT_PX);
    expect(bbox8.bottom - bbox8.top).toBe(5 * LINE_PITCH_8PT_PX);
    const bbox16 = estimateVerticalBBox({
      charCount: 5,
      fontSizeValue: 794,
      anchorRight: 951,
      anchorTop: 509,
    });
    expect(bbox16.right - bbox16.left).toBe(COLUMN_WIDTH_8PT_PX * 2);
    expect(bbox16.bottom - bbox16.top).toBe(5 * LINE_PITCH_8PT_PX * 2);
  });

  test('patchFullRunVtype only changes vtype field', () => {
    const payload = new Uint8Array(34);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 1, true);
    view.setUint32(4, 0, true);
    view.setUint32(8, 5, true);
    view.setUint32(12, 26, true);
    const out = patchFullRunVtype(payload, 10);
    const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(outView.getUint32(8, true)).toBe(10);
    expect(outView.getUint32(0, true)).toBe(1);
    expect(outView.getUint32(12, true)).toBe(26);
  });

  test('L6/L7 roundtrip unchanged after noop re-serialize', async () => {
    const layers = await loadTextLayerBlobs();
    for (const mainId of [6, 7]) {
      const layer = layers.find((l) => l.mainId === mainId)!;
      const patched = patchTextLayerTlv(layer.attributes, layer.addAttributes, {});
      expect(bytesEqual(patched.attributes, layer.attributes)).toBe(true);
      expect(bytesEqual(patched.addAttributes, layer.addAttributes)).toBe(true);
    }
  });

  test('L6 two-line vertical metrics match export_sample', async () => {
    const layers = await loadTextLayerBlobs();
    const l6 = layers.find((l) => l.mainId === 6)!;
    const metrics = verticalTextMetrics(l6.text, 397);
    expect(metrics.lineCount).toBe(2);
    expect(metrics.maxLineChars).toBe(5);
    expect(metrics.width).toBe(91);
    expect(metrics.height).toBe(167);
    const bbox = estimateVerticalTextBBox({
      text: l6.text,
      fontSizeValue: 397,
      anchorRight: 951,
      anchorTop: 509,
    });
    expect(readCanvasBBox(getTlvPayload(parseTextLayerAttributes(l6.attributes).entries, 42)!)).toEqual(
      { left: bbox.left, top: bbox.top, right: bbox.right, bottom: bbox.bottom },
    );
  });

  test('L7 four-line vertical metrics match export_sample', async () => {
    const layers = await loadTextLayerBlobs();
    const l7 = layers.find((l) => l.mainId === 7)!;
    const metrics = verticalTextMetrics(l7.text, 397);
    expect(metrics.lineCount).toBe(4);
    expect(metrics.maxLineChars).toBe(12);
    expect(metrics.width).toBe(204);
    expect(metrics.height).toBe(398);
  });

  test('E6 two-line clone text metrics (二行目も/ある長文テキスト)', () => {
    const text = '二行目も\r\nある長文テキスト';
    const metrics = verticalTextMetrics(text, 397);
    expect(metrics.lineCount).toBe(2);
    expect(metrics.maxLineChars).toBe(8);
    expect(metrics.width).toBe(91);
    expect(metrics.height).toBe(8 * 33 + 2);
    const estimated = estimateVerticalTextBBox({
      text,
      fontSizeValue: 397,
      anchorRight: 700,
      anchorTop: 800,
    });
    expect(estimated.left).toBe(609);
    expect(estimated.bottom).toBe(800 + 266);
    const id72 = encodeCacheWidthHint(metrics.width, true);
    expect(new DataView(id72.buffer).getUint32(0, true)).toBe(90);
  });

  test('three-line extrapolation width and height', () => {
    const text = '一行目\r\n二行目\r\n三行目';
    const metrics = verticalTextMetrics(text, 397);
    expect(metrics.lineCount).toBe(3);
    expect(metrics.maxLineChars).toBe(3);
    expect(metrics.width).toBe(33 + 2 * 57);
    expect(metrics.height).toBe(3 * 33 + 2);
  });
});
