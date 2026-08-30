import { describe, expect, test } from 'vitest';
import { alphaOverRgba, decodeRgbaPng, encodeRgbaPng } from '../canvasPreview';

describe('canvasPreview PNG', () => {
  test('encode→decode preserves RGBA', () => {
    const width = 3;
    const height = 2;
    const src = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
    ]);
    const png = encodeRgbaPng(src, width, height);
    expect(png[0]).toBe(137);
    const decoded = decodeRgbaPng(png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect([...decoded.rgba]).toEqual([...src]);
  });
});

describe('alphaOverRgba', () => {
  test('opaque source replaces destination', () => {
    const dst = new Uint8Array([255, 255, 255, 255]);
    const src = new Uint8Array([0, 0, 0, 255]);
    alphaOverRgba(dst, src);
    expect([...dst]).toEqual([0, 0, 0, 255]);
  });

  test('transparent source leaves destination unchanged', () => {
    const dst = new Uint8Array([1, 2, 3, 255]);
    const src = new Uint8Array([9, 9, 9, 0]);
    alphaOverRgba(dst, src);
    expect([...dst]).toEqual([1, 2, 3, 255]);
  });
});
