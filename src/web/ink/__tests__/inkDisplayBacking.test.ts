import { describe, expect, test } from 'vitest';
import {
  INK_BACKING_ZOOM_SETTLE_MS,
  inkDisplayBackingScale,
  inkDisplayBackingSize,
  nextSettledCssZoom,
} from '../inkDisplayBacking';

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

  test('uses an explicit CSS height when free-transforming a clip', () => {
    const size = inkDisplayBackingSize({
      displayWidth: 216,
      displayHeight: 100,
      rasterWidth: 1200,
      rasterHeight: 1700,
      devicePixelRatio: 2,
      cssZoom: 1,
    });
    expect(size.cssHeight).toBe(100);
    expect(size.pixelW).toBe(432);
    expect(size.pixelH).toBe(200);
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

describe('nextSettledCssZoom', () => {
  test('keeps the last committed backing while live zoom is still moving', () => {
    expect(nextSettledCssZoom(2.4, 1, INK_BACKING_ZOOM_SETTLE_MS - 1)).toBe(1);
  });

  test('commits live zoom after the idle window', () => {
    expect(nextSettledCssZoom(2.4, 1, INK_BACKING_ZOOM_SETTLE_MS)).toBe(2.4);
  });

  test('does not rebuild when live zoom matches the backing', () => {
    expect(nextSettledCssZoom(1.5, 1.5, 10_000)).toBe(1.5);
  });
});
