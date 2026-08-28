import { describe, expect, test } from 'vitest';

import { FakeOffscreenCanvas, countAlphaPixels } from '../fakeCanvas';
import { appendLiveBrushStroke, drawBrushStroke } from '../strokeDraw';

describe('drawBrushStroke live interpolation', () => {
  test('fast pointer gaps are filled instead of leaving dotted stamps', () => {
    const dotted = new FakeOffscreenCanvas(64, 32);
    const dottedCtx = dotted.getContext('2d');
    drawBrushStroke(dottedCtx, [{ x: 4, y: 16, pressure: 1 }], {
      color: '#000000',
      lineWidth: 4,
      globalAlpha: 1,
      composite: 'source-over',
    });
    drawBrushStroke(dottedCtx, [{ x: 60, y: 16, pressure: 1 }], {
      color: '#000000',
      lineWidth: 4,
      globalAlpha: 1,
      composite: 'source-over',
    });

    const connected = new FakeOffscreenCanvas(64, 32);
    const connectedCtx = connected.getContext('2d');
    appendLiveBrushStroke(
      connectedCtx,
      { x: 4, y: 16, pressure: 1 },
      [{ x: 60, y: 16, pressure: 1 }],
      () => ({
        color: '#000000',
        lineWidth: 4,
        globalAlpha: 1,
        composite: 'source-over',
      }),
    );

    const midDotted = dottedCtx.getImageData(32, 16, 1, 1).data[3] ?? 0;
    const midConnected = connectedCtx.getImageData(32, 16, 1, 1).data[3] ?? 0;
    expect(midDotted).toBe(0);
    expect(midConnected).toBeGreaterThan(0);
    expect(countAlphaPixels(connectedCtx, 64, 32)).toBeGreaterThan(countAlphaPixels(dottedCtx, 64, 32));
  });
});
