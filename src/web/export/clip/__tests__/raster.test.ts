import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseClip } from '../container';
import {
  decodeColorOffscreen,
  encodeColorOffscreen,
  gridFor,
  parseAttributeParam,
  rebuildAttribute,
} from '../raster';

const SAMPLE_CLIP = join(process.cwd(), 'sample', 'export_sample.clip');
const LINEART_OFFSCREEN_ID = 48;
const LINEART_WIDTH = 1518;
const LINEART_HEIGHT = 2150;
const LINEART_EXTERNAL_ID = 'extrnlidC39752E934E847509B647C0EE8262DD8';

function expectBytesEqual(actual: Uint8Array, expected: Uint8Array) {
  expect(actual.length).toBe(expected.length);
  expect(Buffer.compare(Buffer.from(actual), Buffer.from(expected))).toBe(0);
}

function makeCheckerboard(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = ((x >> 3) ^ (y >> 3)) & 1 ? 255 : 0;
      const i = (y * width + x) * 4;
      rgba[i] = v;
      rgba[i + 1] = v;
      rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

describe('clip raster', () => {
  test('encode→decode round-trip preserves pixels (small checkerboard)', () => {
    const width = 64;
    const height = 48;
    const src = makeCheckerboard(width, height);
    const encoded = encodeColorOffscreen(src, width, height);
    const decoded = decodeColorOffscreen(encoded.blockDataBody, width, height);
    expectBytesEqual(decoded, src);
    expect(encoded.gridW).toBe(gridFor(width, height).gridW);
    expect(encoded.gridH).toBe(gridFor(width, height).gridH);
  });

  test('encode→decode round-trip preserves pixels (300×520 non-tile multiple)', () => {
    const width = 300;
    const height = 520;
    const src = makeCheckerboard(width, height);
    const encoded = encodeColorOffscreen(src, width, height);
    const decoded = decodeColorOffscreen(encoded.blockDataBody, width, height);
    expectBytesEqual(decoded, src);
    const { gridW, gridH } = gridFor(width, height);
    expect(encoded.gridW).toBe(gridW);
    expect(encoded.gridH).toBe(gridH);
    expect(encoded.blockSizes.length).toBe(gridW * gridH);
  });

  test('sample lineart Offscreen decode→re-encode→decode preserves pixels', () => {
    const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
    const parsed = parseClip(original);
    const exta = parsed.extas.find((e) => e.externalId === LINEART_EXTERNAL_ID);
    expect(exta).toBeDefined();

    const firstDecode = decodeColorOffscreen(exta!.body, LINEART_WIDTH, LINEART_HEIGHT);
    const reencoded = encodeColorOffscreen(firstDecode, LINEART_WIDTH, LINEART_HEIGHT);
    const secondDecode = decodeColorOffscreen(reencoded.blockDataBody, LINEART_WIDTH, LINEART_HEIGHT);

    expectBytesEqual(secondDecode, firstDecode);
    expect(reencoded.gridW).toBe(6);
    expect(reencoded.gridH).toBe(9);
    expect(reencoded.blockSizes.length).toBe(54);
  });

  test('rebuildAttribute preserves InitColor and updates Parameter/BlockSize', async () => {
    const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
    const parsed = parseClip(original);
    const exta = parsed.extas.find((e) => e.externalId === LINEART_EXTERNAL_ID);
    expect(exta).toBeDefined();

    const decoded = decodeColorOffscreen(exta!.body, LINEART_WIDTH, LINEART_HEIGHT);
    const encoded = encodeColorOffscreen(decoded, LINEART_WIDTH, LINEART_HEIGHT);

    const { openDatabase } = await import(
      join(process.cwd(), 'tools/clip-experiments/sqlJsInit.ts')
    );
    const db = await openDatabase(parsed.sqliteBytes);
    const stmt = db.prepare('SELECT Attribute FROM Offscreen WHERE MainId = ?');
    stmt.bind([LINEART_OFFSCREEN_ID]);
    expect(stmt.step()).toBe(true);
    const oldAttr = stmt.get()[0] as Uint8Array;
    stmt.free();
    db.close();

    const newAttr = rebuildAttribute(
      oldAttr,
      LINEART_WIDTH,
      LINEART_HEIGHT,
      encoded.gridW,
      encoded.gridH,
      encoded.blockSizes,
    );

    const oldParams = parseAttributeParam(oldAttr);
    const newParams = parseAttributeParam(newAttr);
    expect(newParams[0]).toBe(LINEART_WIDTH);
    expect(newParams[1]).toBe(LINEART_HEIGHT);
    expect(newParams[2]).toBe(encoded.gridW);
    expect(newParams[3]).toBe(encoded.gridH);
    for (let i = 4; i < 20; i++) {
      expect(newParams[i]).toBe(oldParams[i]);
    }
  });
});
