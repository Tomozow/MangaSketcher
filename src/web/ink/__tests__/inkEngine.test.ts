import { describe, expect, test, vi } from 'vitest';

import { createEditorDocument, sequentialIds } from '../../../domain/document';
import { reduceEditorDocument } from '../../../domain/editorReducer';
import { brushRadius } from '../../../domain/pointers';
import type { StrokePoint } from '../../../domain/stroke';

import { FakeOffscreenCanvas, countAlphaPixels } from '../fakeCanvas';
import { InkEngine, wireInkAutosave } from '../InkEngine';
import { drawBrushStroke } from '../strokeDraw';

const TEST_W = 64;
const TEST_H = 64;

function createTestEngine() {
  const factory = (width: number, height: number) =>
    new FakeOffscreenCanvas(width, height) as unknown as OffscreenCanvas;
  const encodePng = async (canvas: OffscreenCanvas) => {
    const fake = canvas as unknown as FakeOffscreenCanvas;
    const blob = await fake.convertToBlob();
    return blob.arrayBuffer();
  };
  return new InkEngine({
    rasterWidth: TEST_W,
    rasterHeight: TEST_H,
    emptyPng: new ArrayBuffer(0),
    canvasFactory: factory,
    encodePng,
  });
}

function inkLine(points: StrokePoint[]): StrokePoint[] {
  return points;
}

describe('InkEngine production pixel truth', () => {
  test('commitInkBake carries rasterId only; fake InkEngine canvas mutates on bake', async () => {
    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'ink',
      pageCount: 1,
      rasterWidth: TEST_W,
      rasterHeight: TEST_H,
      ids: sequentialIds('page'),
    });
    const page = doc.pages[doc.workspaceOrder[0]!]!;
    const engine = createTestEngine();
    engine.registerRaster(page.rasterId);

    const overlayCtx = engine.beginPenOverlay(page.rasterId);
    drawBrushStroke(overlayCtx, inkLine([{ x: 10, y: 10, pressure: 1 }]), {
      color: '#000000',
      lineWidth: 8,
      globalAlpha: 1,
      composite: 'source-over',
    });

    const beforeBake = countAlphaPixels(engine.getHotContext(page.rasterId)!, TEST_W, TEST_H);
    expect(beforeBake).toBe(0);

    const undoPng = engine.bakePenOverlay(page.rasterId);
    const afterBake = countAlphaPixels(engine.getHotContext(page.rasterId)!, TEST_W, TEST_H);
    expect(afterBake).toBeGreaterThan(0);
    expect(undoPng.byteLength).toBeGreaterThan(0);

    const action = { type: 'commitInkBake' as const, rasterId: page.rasterId };
    expect('data' in action).toBe(false);
    expect(Object.keys(action)).toEqual(['type', 'rasterId']);

    const next = reduceEditorDocument(doc, action, sequentialIds('id'));
    expect(next.inkGeneration).toBe(1);
    expect(next.pages[page.id]).toEqual(doc.pages[page.id]);

    await vi.waitFor(() => {
      expect(engine.encodedPng.get(page.rasterId)?.byteLength).toBeGreaterThan(0);
    });
  });

  test('eraseDirect on page canvas decreases alpha>0 pixels; overlay-only does not pass', () => {
    const rasterId = 'p1:page:a';
    const engine = createTestEngine();
    engine.registerRaster(rasterId);

    const pageCtx = engine.decode(rasterId).getContext('2d')!;
    pageCtx.fillStyle = '#000000';
    pageCtx.globalAlpha = 1;
    pageCtx.fillRect(8, 8, 20, 20);
    const beforeErase = countAlphaPixels(pageCtx, TEST_W, TEST_H);
    expect(beforeErase).toBeGreaterThan(0);

    const eraseCtx = engine.beginEraseDirect(rasterId);
    drawBrushStroke(eraseCtx, inkLine([{ x: 18, y: 18, pressure: 1 }]), {
      color: '#000000',
      lineWidth: brushRadius(28, 1, 'pencil') * 2,
      globalAlpha: 1,
      composite: 'destination-out',
    });
    engine.finishEraseDirect(rasterId);

    const afterErase = countAlphaPixels(engine.getHotContext(rasterId)!, TEST_W, TEST_H);
    expect(afterErase).toBeLessThan(beforeErase);

    const engine2 = createTestEngine();
    const rasterId2 = 'p1:page:b';
    engine2.registerRaster(rasterId2);
    const pageCtx2 = engine2.decode(rasterId2).getContext('2d')!;
    pageCtx2.fillStyle = '#000000';
    pageCtx2.fillRect(8, 8, 20, 20);
    const pageBeforeOverlayErase = countAlphaPixels(pageCtx2, TEST_W, TEST_H);

    const overlayOnly = new FakeOffscreenCanvas(TEST_W, TEST_H);
    const overlayCtx = overlayOnly.getContext('2d')!;
    drawBrushStroke(overlayCtx, inkLine([{ x: 18, y: 18, pressure: 1 }]), {
      color: '#000000',
      lineWidth: 20,
      globalAlpha: 1,
      composite: 'destination-out',
    });
    const pageAfterOverlayErase = countAlphaPixels(pageCtx2, TEST_W, TEST_H);
    expect(pageAfterOverlayErase).toBe(pageBeforeOverlayErase);
  });

  test('100× setWorkspaceView does not clone pages or allocate Uint8ClampedArray', () => {
    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'pan',
      pageCount: 2,
      ids: sequentialIds('page'),
    });
    const pageRefs = doc.workspaceOrder.map((id) => doc.pages[id]);
    const Uint8Spy = vi.spyOn(globalThis, 'Uint8ClampedArray');

    let current = doc;
    for (let i = 0; i < 100; i += 1) {
      current = reduceEditorDocument(
        current,
        { type: 'setWorkspaceView', zoom: 1 + i * 0.01, panX: i, panY: -i },
        sequentialIds('id'),
      );
    }

    for (let i = 0; i < doc.workspaceOrder.length; i += 1) {
      expect(current.pages[doc.workspaceOrder[i]!]).toBe(pageRefs[i]);
    }
    expect(Uint8Spy).not.toHaveBeenCalled();
    Uint8Spy.mockRestore();
  });

  test('pen overlay is full raster size and bakes 1:1 (not upscaled from display size)', () => {
    const rasterId = 'p1:page:b';
    const engine = createTestEngine();
    engine.registerRaster(rasterId);

    const overlay = engine.beginPenOverlay(rasterId);
    overlay.fillStyle = '#000000';
    overlay.fillRect(TEST_W - 4, TEST_H - 4, 2, 2);
    engine.bakePenOverlay(rasterId);

    const hotCtx = engine.getHotContext(rasterId)!;
    const corner = hotCtx.getImageData(TEST_W - 3, TEST_H - 3, 1, 1);
    expect(corner.data[3]).toBeGreaterThan(0);
  });

  test('wireInkAutosave notifies encoding and schedules 800ms save contract', async () => {
    const engine = createTestEngine();
    const rasterId = 'p1:page:c';
    engine.registerRaster(rasterId);

    const started: string[] = [];
    const completed: string[] = [];
    const scheduled: string[][] = [];

    const dispose = wireInkAutosave(engine, {
      notifyEncodingStarted: (id) => started.push(id),
      notifyEncodingComplete: (id) => completed.push(id),
      scheduleDocumentSave: (ids) => scheduled.push([...ids]),
    });

    const overlayCtx = engine.beginPenOverlay(rasterId);
    overlayCtx.fillStyle = '#000000';
    overlayCtx.fillRect(4, 4, 8, 8);
    engine.bakePenOverlay(rasterId);

    expect(started).toContain(rasterId);
    expect(scheduled.some((ids) => ids.includes(rasterId))).toBe(true);

    await vi.waitFor(() => {
      expect(completed).toContain(rasterId);
    });

    dispose();
  });

  test('hot canvas LRU evicts beyond 8 without losing encodedPng', () => {
    const engine = createTestEngine();
    for (let i = 0; i < 10; i += 1) {
      const id = `r${i}`;
      engine.registerRaster(id);
      const ctx = engine.decode(id).getContext('2d')!;
      ctx.fillStyle = '#000000';
      ctx.fillRect(i, i, 2, 2);
      engine.encodedPng.set(id, new ArrayBuffer(16));
    }
    expect(engine.hot.size).toBeLessThanOrEqual(8);
    for (let i = 0; i < 10; i += 1) {
      expect(engine.encodedPng.has(`r${i}`)).toBe(true);
    }
  });

  test('bakePenOverlay without overlay returns empty and does not throw', () => {
    const engine = createTestEngine();
    engine.registerRaster('r-missing');
    expect(engine.bakePenOverlay('r-missing').byteLength).toBe(0);
    engine.beginPenOverlay('r-missing');
    engine.bakePenOverlay('r-missing');
    expect(engine.bakePenOverlay('r-missing').byteLength).toBe(0);
  });

  test('LRU does not drop a raster that has a live pen overlay', () => {
    const engine = createTestEngine();
    engine.registerRaster('live');
    engine.beginPenOverlay('live');
    for (let i = 0; i < 10; i += 1) {
      const id = `other${i}`;
      engine.registerRaster(id);
      engine.decode(id);
    }
    expect(engine.getPenOverlayContext('live')).not.toBeNull();
    const undo = engine.bakePenOverlay('live');
    expect(undo.byteLength).toBeGreaterThanOrEqual(0);
  });

  test('LRU does not evict pinned visible rasters', () => {
    const engine = createTestEngine();
    for (let i = 0; i < 10; i += 1) {
      engine.registerRaster(`r${i}`);
    }
    engine.setPinnedHotRasterIds(['r0', 'r1']);
    for (let i = 0; i < 10; i += 1) {
      engine.decode(`r${i}`);
    }
    expect(engine.hot.has('r0')).toBe(true);
    expect(engine.hot.has('r1')).toBe(true);
  });

  test('restoreRasterFromPng applies undo snapshot without browser PNG decode', () => {
    const rasterId = 'p1:page:undo-snapshot';
    const engine = createTestEngine();
    engine.registerRaster(rasterId);

    const overlayCtx = engine.beginPenOverlay(rasterId);
    overlayCtx.fillStyle = '#000000';
    overlayCtx.fillRect(4, 4, 10, 10);
    engine.bakePenOverlay(rasterId);
    const afterFirstBake = countAlphaPixels(engine.getHotContext(rasterId)!, TEST_W, TEST_H);
    expect(afterFirstBake).toBeGreaterThan(0);

    const overlayCtx2 = engine.beginPenOverlay(rasterId);
    overlayCtx2.fillStyle = '#000000';
    overlayCtx2.fillRect(20, 20, 10, 10);
    const undoPng = engine.bakePenOverlay(rasterId);
    expect(undoPng.byteLength).toBe(8 + TEST_W * TEST_H * 4);
    const afterSecondBake = countAlphaPixels(engine.getHotContext(rasterId)!, TEST_W, TEST_H);
    expect(afterSecondBake).toBeGreaterThan(afterFirstBake);

    const overlayCtx3 = engine.beginPenOverlay(rasterId);
    overlayCtx3.fillStyle = '#000000';
    overlayCtx3.fillRect(30, 30, 10, 10);
    engine.bakePenOverlay(rasterId);

    engine.restoreRasterFromPng(rasterId, undoPng);
    expect(countAlphaPixels(engine.getHotContext(rasterId)!, TEST_W, TEST_H)).toBe(afterFirstBake);
  });

  test('stale encode completions do not overwrite encodedPng after rapid bakes', async () => {
    let resolveFirst: ((buffer: ArrayBuffer) => void) | undefined;
    let encodeCall = 0;
    const factory = (width: number, height: number) =>
      new FakeOffscreenCanvas(width, height) as unknown as OffscreenCanvas;
    const encodePng = async (canvas: OffscreenCanvas) => {
      encodeCall += 1;
      const fake = canvas as unknown as FakeOffscreenCanvas;
      if (encodeCall === 1) {
        return new Promise<ArrayBuffer>((resolve) => {
          resolveFirst = resolve;
        });
      }
      const blob = await fake.convertToBlob();
      return blob.arrayBuffer();
    };
    const engine = new InkEngine({
      rasterWidth: TEST_W,
      rasterHeight: TEST_H,
      emptyPng: new ArrayBuffer(0),
      canvasFactory: factory,
      encodePng,
    });
    const rasterId = 'p1:page:race';
    engine.registerRaster(rasterId);

    const stroke = (x: number) => {
      const overlayCtx = engine.beginPenOverlay(rasterId);
      overlayCtx.fillStyle = '#000000';
      overlayCtx.fillRect(x, x, 12, 12);
      engine.bakePenOverlay(rasterId);
    };

    stroke(4);
    stroke(20);

    await vi.waitFor(() => {
      expect(engine.encodedPng.get(rasterId)?.byteLength).toBeGreaterThan(0);
    });
    const freshBytes = engine.encodedPng.get(rasterId)!.slice(0);
    const freshAlpha = countAlphaPixels(engine.getHotContext(rasterId)!, TEST_W, TEST_H);

    resolveFirst!(new ArrayBuffer(8));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.encodedPng.get(rasterId)?.byteLength).toBe(freshBytes.byteLength);
    expect(countAlphaPixels(engine.getHotContext(rasterId)!, TEST_W, TEST_H)).toBe(freshAlpha);
  });
});
