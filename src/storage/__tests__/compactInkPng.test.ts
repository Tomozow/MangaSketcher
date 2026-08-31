import { describe, expect, test } from 'vitest';
import {
  compactPackRasterPng,
  encodeCompactInkPng,
  encodeInkGrayAlphaPng,
  encodeInkRgbaPng,
  normalizePackRasterPng,
  pngColorType,
  tryDecodePngToRgba,
} from '../compactInkPng';
import { encodeTransparentPngBuffer } from '../transparentPng';

function visiblePixels(rgba: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) {
      continue;
    }
    out.push(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!);
  }
  return out;
}

describe('transparent PNG encoding', () => {
  test('default raster empty png is far smaller than an uncompressed 8MB store', () => {
    const png = encodeTransparentPngBuffer(1200, 1700);
    expect(png.byteLength).toBeLessThan(8 * 1024);
    const decoded = tryDecodePngToRgba(png);
    expect(decoded).not.toBeNull();
    expect(decoded?.width).toBe(1200);
    expect(decoded?.height).toBe(1700);
    expect(decoded?.rgba.every((value) => value === 0)).toBe(true);
    expect(pngColorType(png)).toBe(6);
  });
});

describe('compactPackRasterPng', () => {
  test('passes through invalid png bytes', () => {
    const fake = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    expect(new Uint8Array(compactPackRasterPng(fake.buffer))).toEqual(fake);
  });

  test('leaves drawn rgba ink bytes unchanged', () => {
    const width = 8;
    const height = 4;
    const rgba = new Uint8Array(width * height * 4);
    rgba[4] = 0;
    rgba[5] = 0;
    rgba[6] = 0;
    rgba[7] = 180;
    const ink = encodeInkRgbaPng(rgba, width, height);
    const compact = compactPackRasterPng(ink);
    expect(new Uint8Array(compact)).toEqual(new Uint8Array(ink));
    expect(pngColorType(compact)).toBe(6);
  });

  test('replaces a fully transparent raster with a small empty png', () => {
    const width = 32;
    const height = 24;
    const bulky = encodeInkRgbaPng(new Uint8Array(width * height * 4), width, height);
    const compact = compactPackRasterPng(bulky);
    expect(compact.byteLength).toBeLessThanOrEqual(bulky.byteLength);
    const decoded = tryDecodePngToRgba(compact);
    expect(decoded?.width).toBe(width);
    expect(decoded?.height).toBe(height);
    expect(decoded?.rgba.every((value) => value === 0)).toBe(true);
  });

  test('writes grayscale ink as rgba color type 6', () => {
    const width = 3;
    const height = 2;
    const rgba = new Uint8Array([
      0, 0, 0, 255, 64, 64, 64, 128, 0, 0, 0, 0, 12, 12, 12, 40, 0, 0, 0, 0, 200, 200, 200, 10,
    ]);
    const png = encodeCompactInkPng(rgba, width, height);
    expect(pngColorType(png)).toBe(6);
    const decoded = tryDecodePngToRgba(png);
    expect(decoded).not.toBeNull();
    expect(visiblePixels(decoded!.rgba)).toEqual(visiblePixels(rgba));
  });

  test('normalizes gray+alpha pack rasters back to rgba', () => {
    const width = 4;
    const height = 2;
    const rgba = new Uint8Array(width * height * 4);
    rgba[0] = 0;
    rgba[1] = 0;
    rgba[2] = 0;
    rgba[3] = 255;
    rgba[8] = 48;
    rgba[9] = 48;
    rgba[10] = 48;
    rgba[11] = 90;
    const grayAlpha = encodeInkGrayAlphaPng(rgba, width, height);
    expect(pngColorType(grayAlpha)).toBe(4);
    const normalized = normalizePackRasterPng(grayAlpha);
    expect(pngColorType(normalized)).toBe(6);
    const decoded = tryDecodePngToRgba(normalized);
    expect(visiblePixels(decoded!.rgba)).toEqual(visiblePixels(rgba));
  });

  test('shared empty encoder decodes to a transparent raster', () => {
    const png = encodeTransparentPngBuffer(16, 16);
    const decoded = tryDecodePngToRgba(png);
    expect(decoded?.width).toBe(16);
    expect(decoded?.height).toBe(16);
    expect(decoded?.rgba.every((value) => value === 0)).toBe(true);
  });
});
