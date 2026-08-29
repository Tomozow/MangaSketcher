import { describe, expect, test } from 'vitest';
import { IOS_MAX_CANVAS_AREA, renderScaleForPage } from '../pdfLetterbox';

describe('renderScaleForPage', () => {
  test('does not apply zoom twice; bitmap long edge stays within maxEdge', () => {
    const pageW = 1031.81;
    const pageH = 728.504;
    const scale = renderScaleForPage(pageW, pageH, 416, 293.71, 3.4656684329081435, 2, 2048);
    const bitmapW = pageW * scale;
    const bitmapH = pageH * scale;
    expect(Math.max(bitmapW, bitmapH)).toBeLessThanOrEqual(2048 + 1);
    expect(bitmapW * bitmapH).toBeLessThanOrEqual(IOS_MAX_CANVAS_AREA);
  });

  test('sharp pass uses iOS area budget instead of a 4096 edge cap', () => {
    const pageW = 1031.81;
    const pageH = 728.504;
    const capped4096 = renderScaleForPage(pageW, pageH, 416, 293.71, 7.45, 2, 4096);
    const sharp = renderScaleForPage(pageW, pageH, 416, 293.71, 7.45, 2, 8192);
    expect(sharp).toBeGreaterThan(capped4096);
    expect(pageW * sharp * (pageH * sharp)).toBeLessThanOrEqual(IOS_MAX_CANVAS_AREA);
  });
});
