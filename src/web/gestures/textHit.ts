import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from '../../domain/stripGeometry';
import type { Rect } from '../../domain/types';

/** Screen-pixel padding around the visible text box for text/select hit testing. */
export const TEXT_HIT_PAD_CSS = 5;

/** Inflate the stored raster box by TEXT_HIT_PAD_CSS on every side (page display px). */
export function expandTextHitBox(box: Rect, rasterWidth: number, rasterHeight: number): Rect {
  const padX = (TEXT_HIT_PAD_CSS / PAGE_DISPLAY_W) * rasterWidth;
  const padY = (TEXT_HIT_PAD_CSS / PAGE_DISPLAY_H) * rasterHeight;
  return {
    x: (Number.isFinite(box.x) ? box.x : 0) - padX,
    y: (Number.isFinite(box.y) ? box.y : 0) - padY,
    width: box.width + padX * 2,
    height: box.height + padY * 2,
  };
}
