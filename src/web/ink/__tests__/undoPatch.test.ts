import { describe, expect, test } from 'vitest';

import { encodeInkRgbaPng } from '@/src/storage/compactInkPng';
import { isInkUndoPatch } from '@/src/storage/types';

import { FakeOffscreenCanvas, countAlphaPixels } from '../fakeCanvas';
import { InkEngine } from '../InkEngine';
import { drawBrushStroke } from '../strokeDraw';

const W = 64;
const H = 64;

function engine() {
  return new InkEngine({
    rasterWidth: W,
    rasterHeight: H,
    emptyPng: new ArrayBuffer(0),
    canvasFactory: (w, h) => new FakeOffscreenCanvas(w, h) as unknown as OffscreenCanvas,
    encodePng: async () => new ArrayBuffer(0),
  });
}

function stroke(e: InkEngine, rasterId: string, x: number, y: number, note: boolean) {
  const ctx = e.beginPenOverlay(rasterId);
  drawBrushStroke(ctx, [{ x, y, pressure: 1 }], {
    color: '#000000',
    lineWidth: 8,
    globalAlpha: 1,
    composite: 'source-over',
  });
  if (note) {
    e.noteStrokePoints(rasterId, [{ x, y }], 8);
  }
  e.blitPenOverlay(rasterId);
  return e.drainPendingBakeWork(1, { encode: false })[0]!.canvas;
}

const alpha = (e: InkEngine, rasterId: string) => countAlphaPixels(e.getHotContext(rasterId)!, W, H);

describe('stroke undo keeps only the touched rect', () => {
  test('undo and redo of a patch leave ink outside the rect alone', () => {
    const e = engine();
    const id = 'p:page:a';
    e.registerRaster(id);
    stroke(e, id, 10, 10, false);
    const first = alpha(e, id);
    const undo = stroke(e, id, 40, 40, true);
    const both = alpha(e, id);
    expect(both).toBeGreaterThan(first);

    expect(isInkUndoPatch(undo)).toBe(true);
    if (!isInkUndoPatch(undo)) return;
    expect(undo.canvas.width).toBeLessThan(W / 2);

    const redo = e.captureRasterPixels(id, undo)!;
    e.restoreRasterFromUndo(id, undo);
    expect(alpha(e, id)).toBe(first);
    e.restoreRasterFromUndo(id, redo);
    expect(alpha(e, id)).toBe(both);
  });

  test('a stroke without noted bounds keeps the full snapshot', () => {
    const e = engine();
    e.registerRaster('p:page:a');
    const undo = stroke(e, 'p:page:a', 10, 10, false);
    expect(isInkUndoPatch(undo)).toBe(false);
  });
});

describe('edits on a raster whose PNG is still decoding', () => {
  test('the stored ink is on the canvas before the edit starts', () => {
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < 100; i += 1) {
      rgba[i * 4 + 3] = 255;
    }
    const e = engine();
    const id = 'p:page:cold';
    e.registerRaster(id, encodeInkRgbaPng(rgba, W, H));
    expect(e.needsDecode(id)).toBe(true);
    const undo = stroke(e, id, 40, 40, true);
    expect(e.needsDecode(id)).toBe(false);
    expect(alpha(e, id)).toBeGreaterThan(100);
    e.restoreRasterFromUndo(id, undo);
    expect(alpha(e, id)).toBe(100);
  });
});

describe('which edits the document depends on', () => {
  test('a cut reports both rasters; a pen stroke reports none; undo reports the restored raster', () => {
    const e = engine();
    const needs: string[][] = [];
    e.setCallbacks({ onDocumentNeeds: (ids) => needs.push(ids) });
    const page = 'p:page:a';
    e.registerRaster(page);
    const undo = stroke(e, page, 20, 20, true);
    expect(needs).toEqual([]);

    const cut = e.marqueeCut(page, 'p:clip:c', { x: 0, y: 0, width: W, height: H });
    expect(cut.trim).not.toBeNull();
    expect(needs).toEqual([[page, 'p:clip:c']]);

    e.restoreRasterFromUndo(page, undo);
    expect(needs[1]).toEqual([page]);
  });
});
