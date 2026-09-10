import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, test } from 'vitest';
import { convertWrapToExplicitNewlines } from '../../../../domain/textWrap';
import type { Rect } from '../../../../domain/types';
import {
  buildPageClip,
  clipFontSizePt,
  pageTextToClipSpec,
  type ClipPageTextInput,
} from '../buildPageClip';
import { decodeRgbaPng } from '../canvasPreview';
import { getOffscreenExternalId } from '../clipDb';
import { computeExtaHeaderOffsets, parseClip, type ParsedClip } from '../container';
import {
  CLIP_CANVAS_HEIGHT,
  CLIP_CANVAS_WIDTH,
  CLIP_LINEART_OFFSCREEN_ID,
  CLIP_TEXT_FOLDER_ID,
} from '../exportConstants';
import { getLayerChildren } from '../layerOps';
import { decodeColorOffscreen } from '../raster';
import { FONT_SIZE_SCALE, verticalTextMetrics } from '../textTlv';

const TEMPLATE_PATH = join(process.cwd(), 'public', 'clip-export-template.clip');
const RASTER_W = 1200;
const RASTER_H = 1700;

let sql: SqlJsStatic;
let templateBytes: Uint8Array;
let template: ParsedClip;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  sql = await initSqlJs({ locateFile: () => wasmPath });
  templateBytes = new Uint8Array(readFileSync(TEMPLATE_PATH));
  template = parseClip(templateBytes);
});

function openDb(parsed: ParsedClip): Database {
  return new sql.Database(parsed.sqliteBytes);
}

function textLayerStrings(db: Database): Map<number, string> {
  const out = new Map<number, string>();
  const res = db.exec('SELECT MainId, TextLayerString FROM Layer WHERE TextLayerString IS NOT NULL');
  for (const row of res[0]?.values ?? []) {
    const raw = row[1];
    out.set(
      Number(row[0]),
      raw instanceof Uint8Array ? new TextDecoder('utf-8').decode(raw) : String(raw),
    );
  }
  return out;
}

function extaBody(parsed: ParsedClip, externalId: string): Uint8Array | undefined {
  return parsed.extas.find((e) => e.externalId === externalId)?.body;
}

describe('pageTextToClipSpec', () => {
  const box: Rect = { x: 100, y: 200, width: 200, height: 120 };

  test('converts px font size via canvas scale and 33px/8pt pitch', () => {
    const pt = clipFontSizePt(36, RASTER_W);
    expect(pt).toBeCloseTo(36 * (CLIP_CANVAS_WIDTH / RASTER_W) * (8 / 33), 6);
  });

  test('maps the box top-right to canvas anchors and wraps content', () => {
    const spec = pageTextToClipSpec(
      { content: 'あいうえおかきく', box, fontSize: 36 },
      RASTER_W,
      RASTER_H,
    );
    expect(spec).not.toBeNull();
    expect(spec!.content).toBe('あいう\r\nえおか\r\nきく');
    expect(spec!.anchorRight).toBe(Math.round((box.x + box.width) * (CLIP_CANVAS_WIDTH / RASTER_W)));
    expect(spec!.anchorTop).toBe(Math.round(box.y * (CLIP_CANVAS_HEIGHT / RASTER_H)));
  });

  test('maps horizontal text from the top-left and wraps by width', () => {
    const spec = pageTextToClipSpec(
      { content: 'あいうえおかきく', box, fontSize: 36, writingMode: 'horizontal' },
      RASTER_W,
      RASTER_H,
    );
    expect(spec).not.toBeNull();
    expect(spec!.writingMode).toBe('horizontal');
    expect(spec!.content).toBe('あいうえおかきく'.slice(0, 5) + '\r\n' + 'あいうえおかきく'.slice(5));
    expect(spec!.anchorLeft).toBe(Math.round(box.x * (CLIP_CANVAS_WIDTH / RASTER_W)));
    expect(spec!.anchorTop).toBe(Math.round(box.y * (CLIP_CANVAS_HEIGHT / RASTER_H)));
  });

  test('returns null when the app renders nothing', () => {
    expect(pageTextToClipSpec({ content: '   ', box, fontSize: 36 }, RASTER_W, RASTER_H)).toBeNull();
    expect(
      pageTextToClipSpec(
        { content: 'あ', box: { x: 0, y: 0, width: 0, height: 50 }, fontSize: 36 },
        RASTER_W,
        RASTER_H,
      ),
    ).toBeNull();
  });

  test('clamps the anchor so the TLV bbox never goes negative', () => {
    const spec = pageTextToClipSpec(
      { content: 'あ', box: { x: 0, y: 0, width: 10, height: 100 }, fontSize: 60 },
      RASTER_W,
      RASTER_H,
    );
    expect(spec).not.toBeNull();
    const metrics = verticalTextMetrics(
      spec!.content,
      Math.round(spec!.fontSizePt * FONT_SIZE_SCALE),
    );
    expect(spec!.anchorRight - metrics.width).toBeGreaterThanOrEqual(0);
  });
});

describe('buildPageClip', () => {
  test('creates text layers under the text folder with wrapped CRLF content', () => {
    const texts = [
      { content: 'ひとことだけ', box: { x: 800, y: 100, width: 300, height: 400 } as Rect, fontSize: 36 },
      { content: 'あいうえおかきく', box: { x: 100, y: 200, width: 200, height: 120 } as Rect, fontSize: 36 },
      { content: '   ', box: { x: 0, y: 0, width: 100, height: 100 } as Rect, fontSize: 36 },
    ];
    const out = buildPageClip({
      sql,
      template,
      texts,
      rasterWidth: RASTER_W,
      rasterHeight: RASTER_H,
      lineartRgba: null,
    });

    const parsed = parseClip(out);
    const db = openDb(parsed);
    try {
      const children = getLayerChildren(db, CLIP_TEXT_FOLDER_ID);
      expect(children).toHaveLength(2);

      const strings = [...textLayerStrings(db).values()].sort();
      const expected = [
        convertWrapToExplicitNewlines(texts[0]!.content, texts[0]!.box, texts[0]!.fontSize),
        convertWrapToExplicitNewlines(texts[1]!.content, texts[1]!.box, texts[1]!.fontSize),
      ].sort();
      expect(strings).toEqual(expected);
      expect(strings.some((s) => s.includes('\r\n'))).toBe(true);

      const integrity = db.exec('PRAGMA integrity_check')[0]!.values[0]![0];
      expect(integrity).toBe('ok');

      const rows = db.exec('SELECT ExternalID, Offset FROM ExternalChunk')[0]!.values;
      const offsets = computeExtaHeaderOffsets(parsed.extas);
      expect(rows).toHaveLength(parsed.extas.length);
      for (const [eid, offset] of rows) {
        expect(offsets.get(String(eid))).toBe(Number(offset));
      }
    } finally {
      db.close();
    }
  });

  test('replaces the line-art offscreen from RGBA and keeps it when null', () => {
    const rgba = new Uint8Array(CLIP_CANVAS_WIDTH * CLIP_CANVAS_HEIGHT * 4);
    const px = (100 * CLIP_CANVAS_WIDTH + 100) * 4;
    rgba[px + 3] = 255; // opaque black dot at (100,100)

    const withInk = parseClip(
      buildPageClip({
        sql,
        template,
        texts: [],
        rasterWidth: RASTER_W,
        rasterHeight: RASTER_H,
        lineartRgba: rgba,
      }),
    );
    const withoutInk = parseClip(
      buildPageClip({
        sql,
        template,
        texts: [],
        rasterWidth: RASTER_W,
        rasterHeight: RASTER_H,
        lineartRgba: null,
      }),
    );

    const db = openDb(withInk);
    let externalId: string | null = null;
    try {
      externalId = getOffscreenExternalId(db, CLIP_LINEART_OFFSCREEN_ID);
    } finally {
      db.close();
    }
    expect(externalId).toBeTruthy();

    const templateBody = extaBody(template, externalId!)!;
    const inkBody = extaBody(withInk, externalId!)!;
    const noInkBody = extaBody(withoutInk, externalId!)!;
    expect(inkBody).not.toEqual(templateBody);
    expect(noInkBody).toEqual(templateBody);

    const decoded = decodeColorOffscreen(inkBody, CLIP_CANVAS_WIDTH, CLIP_CANVAS_HEIGHT);
    expect(decoded[px + 3]).toBe(255);
    expect(decoded[px]).toBe(0);
  });

  test('writes CanvasPreview compositing page_template and line art', () => {
    const rgba = new Uint8Array(CLIP_CANVAS_WIDTH * CLIP_CANVAS_HEIGHT * 4);
    const px = (100 * CLIP_CANVAS_WIDTH + 100) * 4;
    rgba[px + 3] = 255;

    const out = parseClip(
      buildPageClip({
        sql,
        template,
        texts: [],
        rasterWidth: RASTER_W,
        rasterHeight: RASTER_H,
        lineartRgba: rgba,
      }),
    );
    const db = openDb(out);
    try {
      const row = db.exec(
        'SELECT ImageType, ImageWidth, ImageHeight, ImageData FROM CanvasPreview WHERE MainId = 1',
      )[0]!.values[0]!;
      expect(row[0]).toBe(1);
      expect(row[1]).toBe(CLIP_CANVAS_WIDTH);
      expect(row[2]).toBe(CLIP_CANVAS_HEIGHT);
      const png = row[3] as Uint8Array;
      const preview = decodeRgbaPng(png);
      expect(preview.rgba[px + 3]).toBe(255);
      expect(preview.rgba[px]).toBe(0);
    } finally {
      db.close();
    }
  });

  test('mints a new document UUID so CSP does not reuse the template thumbnail cache', () => {
    const opts = {
      sql,
      template,
      texts: [] as ClipPageTextInput[],
      rasterWidth: RASTER_W,
      rasterHeight: RASTER_H,
      lineartRgba: null,
    };
    const a = parseClip(buildPageClip(opts));
    const b = parseClip(buildPageClip(opts));
    expect([...a.head.documentUuid]).not.toEqual([...template.head.documentUuid]);
    expect([...b.head.documentUuid]).not.toEqual([...template.head.documentUuid]);
    expect([...a.head.documentUuid]).not.toEqual([...b.head.documentUuid]);
    expect(a.head.documentUuid).toHaveLength(16);
  });

  test('does not mutate the shared template bytes', () => {
    const before = new Uint8Array(templateBytes);
    buildPageClip({
      sql,
      template,
      texts: [{ content: 'あ', box: { x: 10, y: 10, width: 100, height: 100 } as Rect, fontSize: 36 }],
      rasterWidth: RASTER_W,
      rasterHeight: RASTER_H,
      lineartRgba: null,
    });
    expect(templateBytes).toEqual(before);
  });
});
