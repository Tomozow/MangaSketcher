import { describe, expect, test } from 'vitest';

import { FakeOffscreenCanvas, countAlphaPixels } from '../../ink/fakeCanvas';
import { InkEngine } from '../../ink/InkEngine';
import { canvasMarqueeCut, canvasBakeClipOntoPage, inkAlphaBounds } from '../clipCanvas';

const W = 64;
const H = 64;

function createTestEngine() {
  const factory = (width: number, height: number) =>
    new FakeOffscreenCanvas(width, height) as unknown as OffscreenCanvas;
  const encodePng = async (canvas: OffscreenCanvas) => {
    const fake = canvas as unknown as FakeOffscreenCanvas;
    const blob = await fake.convertToBlob();
    return blob.arrayBuffer();
  };
  return new InkEngine({
    rasterWidth: W,
    rasterHeight: H,
    emptyPng: new ArrayBuffer(0),
    canvasFactory: factory,
    encodePng,
  });
}

describe('clip canvas bake (no cutRect)', () => {
  test('canvasMarqueeCut moves pixels via drawImage + clearRect', () => {
    const engine = createTestEngine();
    const pageId = 'p:page:1';
    const clipId = 'p:clip:1';
    engine.registerRaster(pageId);
    const pageCtx = engine.getHotContext(pageId)!;
    pageCtx.fillStyle = '#000000';
    pageCtx.fillRect(4, 4, 8, 8);

    const beforePage = countAlphaPixels(pageCtx, W, H);
    expect(beforePage).toBeGreaterThan(0);

    engine.marqueeCut(pageId, clipId, { x: 4, y: 4, width: 8, height: 8 });

    const afterPage = countAlphaPixels(engine.getHotContext(pageId)!, W, H);
    const clipCtx = engine.getHotContext(clipId)!;
    const clipPixels = countAlphaPixels(clipCtx, clipCtx.canvas.width, clipCtx.canvas.height);
    expect(afterPage).toBeLessThan(beforePage);
    expect(clipPixels).toBeGreaterThan(0);
  });

  test('marqueeCut does not create a clip when the rect has no ink', () => {
    const engine = createTestEngine();
    const pageId = 'p:page:empty';
    const clipId = 'p:clip:empty';
    engine.registerRaster(pageId);
    const result = engine.marqueeCut(pageId, clipId, { x: 4, y: 4, width: 8, height: 8 });
    expect(result.trim).toBeNull();
    expect(engine.hot.has(clipId)).toBe(false);
    expect(countAlphaPixels(engine.getHotContext(pageId)!, W, H)).toBe(0);
  });

  test('marqueeCut crops the clip to ink bounds', () => {
    const engine = createTestEngine();
    const pageId = 'p:page:crop';
    const clipId = 'p:clip:crop';
    engine.registerRaster(pageId);
    const pageCtx = engine.getHotContext(pageId)!;
    pageCtx.fillStyle = '#000000';
    pageCtx.fillRect(8, 10, 4, 6);
    const result = engine.marqueeCut(pageId, clipId, { x: 0, y: 0, width: 32, height: 32 });
    expect(result.trim).toEqual({ x: 7, y: 9, width: 6, height: 8 });
    expect(engine.getRasterDimensions(clipId)).toEqual({ width: 6, height: 8 });
  });

  test('bakeClipOntoPage composites clip with transform', () => {
    const engine = createTestEngine();
    const pageId = 'p:page:1';
    const clipId = 'p:clip:1';
    engine.registerRaster(pageId);
    engine.registerClipRaster(clipId, 6, 6);
    const clipCtx = engine.getHotContext(clipId)!;
    clipCtx.fillStyle = '#000000';
    clipCtx.fillRect(0, 0, 6, 6);

    engine.bakeClipOntoPage(pageId, clipId, 10, 10, 1, 0);
    const pagePixels = countAlphaPixels(engine.getHotContext(pageId)!, W, H);
    expect(pagePixels).toBeGreaterThan(0);
    expect(engine.hot.has(clipId)).toBe(false);
  });

  test('production clip path does not import cutRect', async () => {
    const mod = await import('../clipCanvas');
    expect(Object.keys(mod).sort()).toEqual([
      'canvasBakeClipOntoPage',
      'canvasCopyPageRect',
      'canvasMarqueeCut',
      'cropCanvasToRect',
      'inkAlphaBounds',
    ]);
    const fs = await import('node:fs/promises');
    const webSrc = await fs.readFile('src/web/useEditorController.ts', 'utf8');
    const inkSrc = await fs.readFile('src/web/ink/InkEngine.ts', 'utf8');
    expect(webSrc.includes('cutRect')).toBe(false);
    expect(inkSrc.includes('cutRect')).toBe(false);
  });
});

describe('canvasMarqueeCut unit', () => {
  test('uses drawImage and clearRect only', () => {
    const page = new FakeOffscreenCanvas(W, H) as unknown as OffscreenCanvas;
    const clip = new FakeOffscreenCanvas(10, 10) as unknown as OffscreenCanvas;
    const pageCtx = page.getContext('2d')!;
    pageCtx.fillStyle = '#000';
    pageCtx.fillRect(2, 2, 6, 6);

    canvasMarqueeCut(page, clip, { x: 2, y: 2, width: 6, height: 6 });

    expect(countAlphaPixels(pageCtx, W, H)).toBe(0);
    expect(countAlphaPixels(clip.getContext('2d')!, clip.width, clip.height)).toBeGreaterThan(0);
  });

  test('inkAlphaBounds is null for an empty canvas', () => {
    const clip = new FakeOffscreenCanvas(10, 10) as unknown as OffscreenCanvas;
    expect(inkAlphaBounds(clip)).toBeNull();
  });

  test('inkAlphaBounds shrinks to ink plus 1px pad', () => {
    const clip = new FakeOffscreenCanvas(32, 32) as unknown as OffscreenCanvas;
    const ctx = clip.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(8, 10, 4, 6);
    expect(inkAlphaBounds(clip)).toEqual({ x: 7, y: 9, width: 6, height: 8 });
  });

  test('canvasBakeClipOntoPage draws transformed clip', () => {
    const page = new FakeOffscreenCanvas(W, H) as unknown as OffscreenCanvas;
    const clip = new FakeOffscreenCanvas(4, 4) as unknown as OffscreenCanvas;
    clip.getContext('2d')!.fillStyle = '#000';
    clip.getContext('2d')!.fillRect(0, 0, 4, 4);

    canvasBakeClipOntoPage(page.getContext('2d')!, clip, 4, 4, 8, 8, 1, 0);
    expect(countAlphaPixels(page.getContext('2d')!, W, H)).toBeGreaterThan(0);
  });
});
