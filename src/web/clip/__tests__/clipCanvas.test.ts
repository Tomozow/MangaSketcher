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

  test('marqueeCut undo snapshot restores page ink without a raw RGBA buffer', () => {
    const engine = createTestEngine();
    const pageId = 'p:page:undo';
    const clipId = 'p:clip:undo';
    engine.registerRaster(pageId);
    const pageCtx = engine.getHotContext(pageId)!;
    pageCtx.fillStyle = '#000000';
    pageCtx.fillRect(4, 4, 8, 8);
    const before = countAlphaPixels(pageCtx, W, H);
    const cut = engine.marqueeCut(pageId, clipId, { x: 4, y: 4, width: 8, height: 8 });
    expect(cut.pageUndo instanceof ArrayBuffer).toBe(false);
    expect(countAlphaPixels(engine.getHotContext(pageId)!, W, H)).toBeLessThan(before);
    engine.restoreRasterFromUndo(pageId, cut.pageUndo);
    expect(countAlphaPixels(engine.getHotContext(pageId)!, W, H)).toBe(before);
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

    const baked = engine.bakeClipOntoPage(pageId, clipId, 10, 10, 1, 0);
    const pagePixels = countAlphaPixels(engine.getHotContext(pageId)!, W, H);
    expect(pagePixels).toBeGreaterThan(0);
    expect(engine.hot.has(clipId)).toBe(false);
    expect(baked.clipUndo instanceof ArrayBuffer).toBe(false);
    engine.restoreRasterFromUndo(clipId, baked.clipUndo);
    expect(engine.getRasterDimensions(clipId)).toEqual({ width: 6, height: 6 });
    const restoredClip = engine.getHotContext(clipId)!;
    expect(countAlphaPixels(restoredClip, restoredClip.canvas.width, restoredClip.canvas.height)).toBeGreaterThan(0);
  });

  test('lassoCut keeps only ink inside the polygon and crops to a rectangle', () => {
    const engine = createTestEngine();
    const pageId = 'p:page:lasso';
    const clipId = 'p:clip:lasso';
    engine.registerRaster(pageId);
    const pageCtx = engine.getHotContext(pageId)!;
    pageCtx.fillStyle = '#000000';
    pageCtx.fillRect(4, 4, 20, 20);
    const beforePage = countAlphaPixels(pageCtx, W, H);

    const points = [
      { x: 4, y: 4 },
      { x: 24, y: 4 },
      { x: 4, y: 24 },
    ];
    const result = engine.lassoCut(pageId, clipId, points, { x: 3, y: 3, width: 22, height: 22 });
    expect(result.trim).not.toBeNull();
    const clipDims = engine.getRasterDimensions(clipId);
    expect(clipDims.width).toBe(result.trim!.width);
    expect(clipDims.height).toBe(result.trim!.height);

    const afterPage = countAlphaPixels(engine.getHotContext(pageId)!, W, H);
    const clipCtx = engine.getHotContext(clipId)!;
    const clipPixels = countAlphaPixels(clipCtx, clipCtx.canvas.width, clipCtx.canvas.height);
    expect(afterPage).toBeLessThan(beforePage);
    expect(clipPixels).toBeGreaterThan(0);
    expect(clipPixels).toBeLessThan(beforePage);
  });

  test('lassoCut does not create a clip or erase the page when the polygon has no ink', () => {
    const engine = createTestEngine();
    const pageId = 'p:page:lasso-empty';
    const clipId = 'p:clip:lasso-empty';
    engine.registerRaster(pageId);
    const pageCtx = engine.getHotContext(pageId)!;
    pageCtx.fillStyle = '#000000';
    pageCtx.fillRect(40, 40, 8, 8);
    const beforePage = countAlphaPixels(pageCtx, W, H);
    const result = engine.lassoCut(
      pageId,
      clipId,
      [
        { x: 2, y: 2 },
        { x: 12, y: 2 },
        { x: 2, y: 12 },
      ],
      { x: 1, y: 1, width: 12, height: 12 },
    );
    expect(result.trim).toBeNull();
    expect(engine.hot.has(clipId)).toBe(false);
    expect(countAlphaPixels(engine.getHotContext(pageId)!, W, H)).toBe(beforePage);
  });

  test('production clip path does not import cutRect', async () => {
    const mod = await import('../clipCanvas');
    expect(Object.keys(mod).sort()).toEqual([
      'canvasBakeClipOntoPage',
      'canvasClearLassoPolygon',
      'canvasCopyLassoRegion',
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

  test('cutClipRegion copies the polygon into a new clip and leaves a hole', () => {
    const engine = createTestEngine();
    const sourceId = 'p:clip:src';
    const destId = 'p:clip:piece';
    engine.registerClipRaster(sourceId, 32, 32);
    const srcCtx = engine.getHotContext(sourceId)!;
    srcCtx.fillStyle = '#000000';
    srcCtx.fillRect(4, 4, 20, 20);
    const before = countAlphaPixels(srcCtx, 32, 32);
    const cut = engine.cutClipRegion(sourceId, destId, [
      { x: 4, y: 4 },
      { x: 16, y: 4 },
      { x: 16, y: 16 },
      { x: 4, y: 16 },
    ]);
    expect(cut.pieceOrigin).not.toBeNull();
    expect(cut.sourceTrim).not.toBeNull();
    const destCtx = engine.getHotContext(destId)!;
    const destPixels = countAlphaPixels(destCtx, destCtx.canvas.width, destCtx.canvas.height);
    const after = countAlphaPixels(engine.getHotContext(sourceId)!, engine.getRasterDimensions(sourceId).width, engine.getRasterDimensions(sourceId).height);
    expect(destPixels).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    expect(after + destPixels).toBe(before);
  });

  test('cutClipRegion skips empty polygons and leaves the source', () => {
    const engine = createTestEngine();
    const sourceId = 'p:clip:empty-cut';
    const destId = 'p:clip:empty-piece';
    engine.registerClipRaster(sourceId, 32, 32);
    const srcCtx = engine.getHotContext(sourceId)!;
    srcCtx.fillStyle = '#000000';
    srcCtx.fillRect(20, 20, 8, 8);
    const before = countAlphaPixels(srcCtx, 32, 32);
    const cut = engine.cutClipRegion(sourceId, destId, [
      { x: 1, y: 1 },
      { x: 8, y: 1 },
      { x: 1, y: 8 },
    ]);
    expect(cut.pieceOrigin).toBeNull();
    expect(engine.hot.has(destId)).toBe(false);
    expect(countAlphaPixels(engine.getHotContext(sourceId)!, 32, 32)).toBe(before);
  });

  test('cutClipRegion undo restores the source raster size and ink', () => {
    const engine = createTestEngine();
    const sourceId = 'p:clip:undo-src';
    const destId = 'p:clip:undo-piece';
    engine.registerClipRaster(sourceId, 32, 32);
    const srcCtx = engine.getHotContext(sourceId)!;
    srcCtx.fillStyle = '#000000';
    srcCtx.fillRect(2, 2, 20, 20);
    const before = countAlphaPixels(srcCtx, 32, 32);
    const cut = engine.cutClipRegion(sourceId, destId, [
      { x: 2, y: 2 },
      { x: 22, y: 2 },
      { x: 22, y: 22 },
      { x: 2, y: 22 },
    ]);
    expect(cut.sourceTrim).toBeNull();
    engine.restoreRasterFromUndo(sourceId, cut.sourceUndo);
    expect(engine.getRasterDimensions(sourceId)).toEqual({ width: 32, height: 32 });
    expect(countAlphaPixels(engine.getHotContext(sourceId)!, 32, 32)).toBe(before);
  });
});
