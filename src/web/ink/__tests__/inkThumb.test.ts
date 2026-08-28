import { describe, expect, test, vi } from 'vitest';

import { brushRadius } from '../../../domain/pointers';
import type { StrokePoint } from '../../../domain/stroke';

import {
  COMPACT_THUMB_HEIGHT,
  COMPACT_THUMB_WIDTH,
  InkEngine,
  THUMB_HEIGHT,
  THUMB_WIDTH,
} from '../InkEngine';
import {
  FakeImageBitmap,
  FakeOffscreenCanvas,
  countAlphaPixels,
  fakeCreateImageBitmap,
} from '../fakeCanvas';
import { drawBrushStroke } from '../strokeDraw';

const TEST_W = 64;
const TEST_H = 64;

function grayTemplate(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void {
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
}

function createThumbEngine() {
  const factory = (width: number, height: number) =>
    new FakeOffscreenCanvas(width, height) as unknown as OffscreenCanvas;
  const encodePng = async (canvas: OffscreenCanvas) => {
    const fake = canvas as unknown as FakeOffscreenCanvas;
    const blob = await fake.convertToBlob();
    return blob.arrayBuffer();
  };
  const createThumbBitmap = async (canvas: OffscreenCanvas) =>
    fakeCreateImageBitmap(canvas as unknown as FakeOffscreenCanvas) as unknown as ImageBitmap;
  return new InkEngine({
    rasterWidth: TEST_W,
    rasterHeight: TEST_H,
    emptyPng: new ArrayBuffer(0),
    canvasFactory: factory,
    encodePng,
    createThumbBitmap,
    drawTemplate: grayTemplate,
  });
}

function inkLine(points: StrokePoint[]): StrokePoint[] {
  return points;
}

describe('InkEngine thumbnails (§9.7)', () => {
  test('exports spec thumb dimensions: 144×204 standard, 112×158 compact', () => {
    expect(THUMB_WIDTH).toBe(144);
    expect(THUMB_HEIGHT).toBe(204);
    expect(COMPACT_THUMB_WIDTH).toBe(112);
    expect(COMPACT_THUMB_HEIGHT).toBe(158);
  });

  test('bakePenOverlay generates 144×204 thumb with template + ink', async () => {
    const rasterId = 'p1:page:thumb-a';
    const engine = createThumbEngine();
    engine.registerRaster(rasterId);

    const overlayCtx = engine.beginPenOverlay(rasterId);
    overlayCtx.fillStyle = '#000000';
    overlayCtx.fillRect(10, 10, 12, 12);
    engine.bakePenOverlay(rasterId);

    await vi.waitFor(() => {
      expect(engine.getThumb(rasterId)).toBeDefined();
    });

    const thumb = engine.getThumb(rasterId)! as unknown as FakeImageBitmap;
    expect(thumb.width).toBe(THUMB_WIDTH);
    expect(thumb.height).toBe(THUMB_HEIGHT);

    const thumbCtx = thumb.canvas.getContext('2d')!;
    const templateOnly = countAlphaPixels(thumbCtx, THUMB_WIDTH, THUMB_HEIGHT);
    expect(templateOnly).toBeGreaterThan(0);

    const inkCorner = thumbCtx.getImageData(
      Math.floor((10 / TEST_W) * THUMB_WIDTH),
      Math.floor((10 / TEST_H) * THUMB_HEIGHT),
      1,
      1,
    );
    expect(inkCorner.data[3]).toBeGreaterThan(0);
  });

  test('finishEraseDirect regenerates thumb after erase', async () => {
    const rasterId = 'p1:page:thumb-b';
    const engine = createThumbEngine();
    engine.registerRaster(rasterId);

    const pageCtx = engine.decode(rasterId).getContext('2d')!;
    pageCtx.fillStyle = '#000000';
    pageCtx.fillRect(8, 8, 20, 20);
    await engine.generateThumb(rasterId);
    const before = engine.getThumb(rasterId)! as unknown as FakeImageBitmap;
    const inkX = Math.floor((18 / TEST_W) * THUMB_WIDTH);
    const inkY = Math.floor((18 / TEST_H) * THUMB_HEIGHT);
    expect(before.canvas.getContext('2d')!.getImageData(inkX, inkY, 1, 1).data[0]).toBe(0);

    const eraseCtx = engine.beginEraseDirect(rasterId);
    drawBrushStroke(eraseCtx, inkLine([{ x: 18, y: 18, pressure: 1 }]), {
      color: '#000000',
      lineWidth: brushRadius(28, 1, 'pencil') * 2,
      globalAlpha: 1,
      composite: 'destination-out',
    });
    engine.finishEraseDirect(rasterId);

    await vi.waitFor(() => {
      const next = engine.getThumb(rasterId);
      expect(next).toBeDefined();
      expect(next).not.toBe(before);
    });

    const after = engine.getThumb(rasterId)! as unknown as FakeImageBitmap;
    const erased = after.canvas.getContext('2d')!.getImageData(inkX, inkY, 1, 1);
    expect(erased.data[0]).toBe(192);
    expect(before.isClosed()).toBe(true);
  });

  test('invalidateThumb on bake removes stale thumb until regen completes', async () => {
    const rasterId = 'p1:page:thumb-c';
    const engine = createThumbEngine();
    engine.registerRaster(rasterId);

    const pageCtx = engine.decode(rasterId).getContext('2d')!;
    pageCtx.fillStyle = '#000000';
    pageCtx.fillRect(4, 4, 8, 8);
    await engine.generateThumb(rasterId);
    const first = engine.getThumb(rasterId)!;

    const overlayCtx = engine.beginPenOverlay(rasterId);
    overlayCtx.fillStyle = '#000000';
    overlayCtx.fillRect(20, 20, 6, 6);
    engine.bakePenOverlay(rasterId);
    expect(engine.getThumb(rasterId)).toBeUndefined();

    await vi.waitFor(() => {
      expect(engine.getThumb(rasterId)).toBeDefined();
    });
    expect(engine.getThumb(rasterId)).not.toBe(first);
  });

  test('restoreRasterFromPng invalidates and regenerates thumb (undo path)', async () => {
    const rasterId = 'p1:page:thumb-d';
    const engine = createThumbEngine();
    engine.registerRaster(rasterId);

    const pageCtx = engine.decode(rasterId).getContext('2d')!;
    pageCtx.fillStyle = '#000000';
    pageCtx.fillRect(6, 6, 10, 10);
    await engine.generateThumb(rasterId);
    const before = engine.getThumb(rasterId)! as unknown as FakeImageBitmap;
    const inkX = Math.floor((8 / TEST_W) * THUMB_WIDTH);
    const inkY = Math.floor((8 / TEST_H) * THUMB_HEIGHT);
    expect(before.canvas.getContext('2d')!.getImageData(inkX, inkY, 1, 1).data[0]).toBe(0);

    const emptyPage = new FakeOffscreenCanvas(TEST_W, TEST_H);
    const emptyPng = await emptyPage.convertToBlob().then((b) => b.arrayBuffer());
    engine.restoreRasterFromPng(rasterId, emptyPng);

    await vi.waitFor(() => {
      const next = engine.getThumb(rasterId);
      expect(next).toBeDefined();
      expect(next).not.toBe(before);
    });

    const after = engine.getThumb(rasterId)! as unknown as FakeImageBitmap;
    expect(after.canvas.getContext('2d')!.getImageData(inkX, inkY, 1, 1).data[0]).toBe(192);
    expect(before.isClosed()).toBe(true);
  });
});
