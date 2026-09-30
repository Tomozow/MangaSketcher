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

describe('needsDecode / ensureDecoded', () => {
  test('a raster with a stored PNG but no hot canvas must be decoded before edits', async () => {
    const e = new InkEngine({
      rasterWidth: 8,
      rasterHeight: 8,
      emptyPng: new ArrayBuffer(0),
      canvasFactory: (w, h) => new FakeOffscreenCanvas(w, h) as unknown as OffscreenCanvas,
      encodePng: async () => PNG,
    });
    e.registerRaster('p:clip:a', PNG);
    e.registerRaster('p:clip:blank');
    expect(e.needsDecode('p:clip:a')).toBe(true);
    expect(e.needsDecode('p:clip:blank')).toBe(false);
    await e.ensureDecoded(['p:clip:a']);
    expect(e.hot.has('p:clip:a')).toBe(true);
    expect(e.needsDecode('p:clip:a')).toBe(false);
  });
});

describe('pinned rasters and the hot limit', () => {
  test('pinned canvases do not use up the unpinned budget', () => {
    const e = new InkEngine({
      rasterWidth: 8,
      rasterHeight: 8,
      emptyPng: new ArrayBuffer(0),
      canvasFactory: (w, h) => new FakeOffscreenCanvas(w, h) as unknown as OffscreenCanvas,
      encodePng: async () => PNG,
    });
    const ids = Array.from({ length: 17 }, (_, i) => `p:page:${i}`);
    for (const id of ids) e.registerRaster(id, PNG);
    e.setPinnedHotRasterIds(ids.slice(0, 8));
    for (const id of ids.slice(0, 16)) e.decode(id);
    expect(e.hot.size).toBe(16);
    e.decode(ids[16]!);
    expect(e.hot.size).toBe(16);
    expect(ids.slice(0, 8).every((id) => e.hot.has(id))).toBe(true);
    expect(e.hot.has(ids[8]!)).toBe(false);
  });
});

describe('eviction never takes the raster being used', () => {
  test('decode returns a live canvas even when every other canvas is unevictable', () => {
    const e = new InkEngine({
      rasterWidth: 8,
      rasterHeight: 8,
      emptyPng: new ArrayBuffer(0),
      canvasFactory: (w, h) => new FakeOffscreenCanvas(w, h) as unknown as OffscreenCanvas,
      encodePng: async () => PNG,
    });
    // Blank rasters (no PNG yet) are never evicted.
    const blanks = Array.from({ length: 10 }, (_, i) => `p:page:blank${i}`);
    for (const id of blanks) {
      e.registerRaster(id);
      e.decode(id);
    }
    e.registerRaster('p:page:ink', PNG);
    const canvas = e.decode('p:page:ink');
    expect(e.hot.get('p:page:ink')).toBe(canvas);
    expect(canvas.width).toBe(8);
  });
});
