import { describe, expect, test } from 'vitest';

import { FakeOffscreenCanvas } from '../fakeCanvas';
import { InkEngine } from '../InkEngine';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;

describe('hot canvas eviction', () => {
  test('a raster with baked-but-unencoded strokes is never evicted', () => {
    const e = new InkEngine({
      rasterWidth: 8,
      rasterHeight: 8,
      emptyPng: new ArrayBuffer(0),
      canvasFactory: (w, h) => new FakeOffscreenCanvas(w, h) as unknown as OffscreenCanvas,
      encodePng: async () => PNG,
    });
    const ids = Array.from({ length: 14 }, (_, i) => `p:page:${i}`);
    for (const id of ids) e.registerRaster(id, PNG);
    e.beginPenOverlay(ids[0]!);
    e.blitPenOverlay(ids[0]!);
    for (const id of ids.slice(1)) e.decode(id);
    expect(e.hot.has(ids[0]!)).toBe(true);
  });
});
