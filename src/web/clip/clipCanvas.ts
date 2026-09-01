import type { Rect } from '../../domain/types';

type Ink2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type InkCanvas = OffscreenCanvas;

const ALPHA_PAD_PX = 1;

/**
 * Tight bounding box of non-transparent pixels, padded 1px for antialias.
 * Returns null when the canvas has no ink.
 */
export function inkAlphaBounds(canvas: InkCanvas): Rect | null {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width < 1 || canvas.height < 1) {
    return null;
  }
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * 4 + 3]! > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  minX = Math.max(0, minX - ALPHA_PAD_PX);
  minY = Math.max(0, minY - ALPHA_PAD_PX);
  maxX = Math.min(width - 1, maxX + ALPHA_PAD_PX);
  maxY = Math.min(height - 1, maxY + ALPHA_PAD_PX);
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function cropCanvasToRect(
  source: InkCanvas,
  rect: Rect,
  factory: (width: number, height: number) => InkCanvas,
): InkCanvas {
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const dest = factory(w, h);
  const ctx = dest.getContext('2d');
  if (!ctx) {
    throw new Error('cropCanvasToRect: 2d context unavailable');
  }
  ctx.drawImage(
    source as unknown as CanvasImageSource,
    Math.round(rect.x),
    Math.round(rect.y),
    w,
    h,
    0,
    0,
    w,
    h,
  );
  return dest;
}

/** Copy a page rect onto a clip canvas. Does not modify the page. */
export function canvasCopyPageRect(pageCanvas: InkCanvas, clipCanvas: InkCanvas, rect: Rect): void {
  const clipCtx = clipCanvas.getContext('2d');
  if (!clipCtx) {
    throw new Error('canvasCopyPageRect: 2d context unavailable');
  }
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  clipCtx.clearRect(0, 0, clipCanvas.width, clipCanvas.height);
  clipCtx.drawImage(pageCanvas as unknown as CanvasImageSource, x0, y0, w, h, 0, 0, w, h);
}

/**
 * §9.4 production marquee cut — Canvas 2D only (drawImage + clearRect). No JS pixel loops.
 */
export function canvasMarqueeCut(
  pageCanvas: InkCanvas,
  clipCanvas: InkCanvas,
  rect: Rect,
): void {
  const pageCtx = pageCanvas.getContext('2d');
  if (!pageCtx) {
    throw new Error('canvasMarqueeCut: 2d context unavailable');
  }
  canvasCopyPageRect(pageCanvas, clipCanvas, rect);
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  pageCtx.clearRect(x0, y0, w, h);
}

/**
 * §9.4 bake clip onto page with transform, then caller disposes clip raster.
 */
export function canvasBakeClipOntoPage(
  pageCtx: Ink2DContext,
  clipCanvas: InkCanvas,
  clipWidth: number,
  clipHeight: number,
  pageLocalX: number,
  pageLocalY: number,
  scale: number,
  rotation: number,
  scaleY: number = scale,
): void {
  const cx = pageLocalX + (clipWidth * scale) / 2;
  const cy = pageLocalY + (clipHeight * scaleY) / 2;
  pageCtx.save();
  pageCtx.translate(cx, cy);
  pageCtx.rotate(rotation);
  pageCtx.scale(scale, scaleY);
  pageCtx.drawImage(clipCanvas as unknown as CanvasImageSource, -clipWidth / 2, -clipHeight / 2);
  pageCtx.restore();
}
