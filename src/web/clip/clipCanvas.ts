import type { Rect } from '../../domain/types';

type Ink2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type InkCanvas = OffscreenCanvas;

/**
 * §9.4 production marquee cut — Canvas 2D only (drawImage + clearRect). No JS pixel loops.
 */
export function canvasMarqueeCut(
  pageCanvas: InkCanvas,
  clipCanvas: InkCanvas,
  rect: Rect,
): void {
  const pageCtx = pageCanvas.getContext('2d');
  const clipCtx = clipCanvas.getContext('2d');
  if (!pageCtx || !clipCtx) {
    throw new Error('canvasMarqueeCut: 2d context unavailable');
  }

  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));

  clipCtx.clearRect(0, 0, clipCanvas.width, clipCanvas.height);
  clipCtx.drawImage(pageCanvas as unknown as CanvasImageSource, x0, y0, w, h, 0, 0, w, h);
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
): void {
  const cx = pageLocalX + (clipWidth * scale) / 2;
  const cy = pageLocalY + (clipHeight * scale) / 2;
  pageCtx.save();
  pageCtx.translate(cx, cy);
  pageCtx.rotate(rotation);
  pageCtx.scale(scale, scale);
  pageCtx.drawImage(clipCanvas as unknown as CanvasImageSource, -clipWidth / 2, -clipHeight / 2);
  pageCtx.restore();
}
