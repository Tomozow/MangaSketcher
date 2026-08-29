import { describe, expect, test } from 'vitest';
import { TEMPLATE_PAGE_NUMBER_COVER } from '../../../domain/types';
import { canvasToPngBlob, paintExportPageLayers, type ExportComposeContext } from '../composePagePng';
import { WorkspaceExportError } from '../errors';

type Fill = { x: number; y: number; w: number; h: number; fillStyle: string };
type Draw = { src: unknown; x: number; y: number; w: number; h: number };

function recordingContext() {
  const fills: Fill[] = [];
  const draws: Draw[] = [];
  const ctx: ExportComposeContext = {
    font: '',
    fillStyle: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillText() {},
    fillRect(x, y, w, h) {
      fills.push({ x, y, w, h, fillStyle: ctx.fillStyle });
    },
    drawImage(image, dx, dy, dw, dh) {
      draws.push({ src: image, x: dx, y: dy, w: dw, h: dh });
    },
  };
  return { ctx, fills, draws };
}

describe('paintExportPageLayers', () => {
  test('fills white, draws template, covers page number, then ink', () => {
    const { ctx, fills, draws } = recordingContext();
    const template = { kind: 'template' };
    const ink = { kind: 'ink' };
    paintExportPageLayers(ctx, {
      width: 1200,
      height: 1700,
      template: template as unknown as CanvasImageSource,
      inkBitmap: ink as unknown as CanvasImageSource,
      texts: [],
    });
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe('high');
    expect(fills[0]).toEqual({ x: 0, y: 0, w: 1200, h: 1700, fillStyle: '#FFFFFF' });
    expect(draws[0]?.src).toBe(template);
    expect(fills[1]).toEqual({
      x: TEMPLATE_PAGE_NUMBER_COVER.x * 1200,
      y: TEMPLATE_PAGE_NUMBER_COVER.y * 1700,
      w: TEMPLATE_PAGE_NUMBER_COVER.width * 1200,
      h: TEMPLATE_PAGE_NUMBER_COVER.height * 1700,
      fillStyle: '#FFFFFF',
    });
    expect(draws[1]?.src).toBe(ink);
  });
});

describe('canvasToPngBlob', () => {
  test('OffscreenCanvas convertToBlob null is failure', async () => {
    const canvas = {
      convertToBlob: async () => null,
    } as unknown as OffscreenCanvas;
    await expect(canvasToPngBlob(canvas)).rejects.toBeInstanceOf(WorkspaceExportError);
  });

  test('convertToBlob empty blob is failure', async () => {
    const canvas = {
      convertToBlob: async () => new Blob([]),
    } as unknown as OffscreenCanvas;
    await expect(canvasToPngBlob(canvas)).rejects.toBeInstanceOf(WorkspaceExportError);
  });
});
