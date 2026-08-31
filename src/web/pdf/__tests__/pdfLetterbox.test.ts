import { describe, expect, test } from 'vitest';
import { PDF_MAX_EDGE, PDF_SHARP_MAX_EDGE } from '../constants';
import {
  IOS_MAX_CANVAS_AREA,
  bitmapCoversNeededScale,
  decidePdfPaint,
  planPdfPaint,
  renderScaleForPage,
} from '../pdfLetterbox';

const sample = {
  pageW: 1031.81,
  pageH: 728.504,
  cssW: 416,
  cssH: 293.71,
};

describe('renderScaleForPage', () => {
  test('does not apply zoom twice; bitmap long edge stays within maxEdge', () => {
    const scale = renderScaleForPage(
      sample.pageW,
      sample.pageH,
      sample.cssW,
      sample.cssH,
      3.4656684329081435,
      2,
      2048,
    );
    const bitmapW = sample.pageW * scale;
    const bitmapH = sample.pageH * scale;
    expect(Math.max(bitmapW, bitmapH)).toBeLessThanOrEqual(2048 + 1);
    expect(bitmapW * bitmapH).toBeLessThanOrEqual(IOS_MAX_CANVAS_AREA);
  });

  test('sharp pass uses iOS area budget instead of a 4096 edge cap', () => {
    const capped4096 = renderScaleForPage(
      sample.pageW,
      sample.pageH,
      sample.cssW,
      sample.cssH,
      7.45,
      2,
      4096,
    );
    const sharp = renderScaleForPage(
      sample.pageW,
      sample.pageH,
      sample.cssW,
      sample.cssH,
      7.45,
      2,
      8192,
    );
    expect(sharp).toBeGreaterThan(capped4096);
    expect(sample.pageW * sharp * (sample.pageH * sharp)).toBeLessThanOrEqual(IOS_MAX_CANVAS_AREA);
  });
});

describe('planPdfPaint', () => {
  test('zoom 1 does not queue a sharp pass that would redraw the same pixels', () => {
    const plan = planPdfPaint(
      sample.pageW,
      sample.pageH,
      sample.cssW,
      sample.cssH,
      1,
      2,
      PDF_MAX_EDGE,
      PDF_SHARP_MAX_EDGE,
    );
    expect(plan.runSharpPass).toBe(false);
    expect(plan.sharpScale).toBeCloseTo(plan.previewScale, 6);
  });

  test('high zoom still plans a sharp pass so text stays readable', () => {
    const plan = planPdfPaint(
      sample.pageW,
      sample.pageH,
      sample.cssW,
      sample.cssH,
      7.45,
      2,
      PDF_MAX_EDGE,
      PDF_SHARP_MAX_EDGE,
    );
    expect(plan.runSharpPass).toBe(true);
    expect(plan.sharpScale).toBeGreaterThan(plan.previewScale * 1.2);
  });
});

describe('decidePdfPaint', () => {
  const zoom1 = planPdfPaint(
    sample.pageW,
    sample.pageH,
    sample.cssW,
    sample.cssH,
    1,
    2,
    PDF_MAX_EDGE,
    PDF_SHARP_MAX_EDGE,
  );
  const zoomHigh = planPdfPaint(
    sample.pageW,
    sample.pageH,
    sample.cssW,
    sample.cssH,
    7.45,
    2,
    PDF_MAX_EDGE,
    PDF_SHARP_MAX_EDGE,
  );

  test('first visit at zoom 1 renders once', () => {
    expect(decidePdfPaint(zoom1, null)).toEqual({ immediate: 'render-preview', needSharp: false });
  });

  test('first visit at high zoom keeps the deferred sharp pass', () => {
    expect(decidePdfPaint(zoomHigh, null)).toEqual({ immediate: 'render-preview', needSharp: true });
  });

  test('zoom out reuses a sharp bitmap without another render', () => {
    expect(decidePdfPaint(zoom1, zoomHigh.sharpScale)).toEqual({ immediate: 'blit', needSharp: false });
    expect(bitmapCoversNeededScale(zoomHigh.sharpScale, zoom1.previewScale)).toBe(true);
  });

  test('preview cache at high zoom blits immediately then still sharpens', () => {
    expect(decidePdfPaint(zoomHigh, zoomHigh.previewScale)).toEqual({
      immediate: 'blit',
      needSharp: true,
    });
  });
});
