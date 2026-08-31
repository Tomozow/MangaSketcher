import { describe, expect, test } from 'vitest';
import { inkDisplayBackingScale, inkDisplayBackingSize } from '../inkDisplayBacking';

describe('inkDisplayBackingScale', () => {
  test('uses 2× on a 1× desktop so lines are not softer than the template', () => {
    expect(inkDisplayBackingScale(1, 1)).toBe(2);
  });

  test('keeps device pixel ratio when it is already 2× or more', () => {
    expect(inkDisplayBackingScale(2, 1)).toBe(2);
    expect(inkDisplayBackingScale(3, 1)).toBe(3);
  });

  test('multiplies workspace zoom', () => {
    expect(inkDisplayBackingScale(2, 2)).toBe(4);
  });
});

describe('inkDisplayBackingSize', () => {
  test('caps at the raster so a 1200×1700 page is never upscaled past truth', () => {
    const size = inkDisplayBackingSize({
      displayWidth: 216,
      rasterWidth: 1200,
      rasterHeight: 1700,
      devicePixelRatio: 2,
      cssZoom: 4,
    });
    expect(size.pixelW).toBe(1200);
    expect(size.pixelH).toBe(1700);
    expect(size.cssHeight).toBe(306);
  });

  test('at rest on 2× is 432×612', () => {
    const size = inkDisplayBackingSize({
      displayWidth: 216,
      rasterWidth: 1200,
      rasterHeight: 1700,
      devicePixelRatio: 2,
      cssZoom: 1,
    });
    expect(size.pixelW).toBe(432);
    expect(size.pixelH).toBe(612);
  });
});
