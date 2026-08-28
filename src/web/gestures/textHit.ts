import { PAGE_DISPLAY_W } from '../../domain/stripGeometry';
import type { Rect } from '../../domain/types';

export const MIN_TEXT_HIT_CSS = 44;

/** Grow left (vertical-rl) to at least 44 CSS px. Uses stored box size otherwise. */
export function expandTextHitBox(box: Rect, rasterWidth: number): Rect {
  const minW = (MIN_TEXT_HIT_CSS / PAGE_DISPLAY_W) * rasterWidth;
  const width = Math.max(box.width, minW);
  return {
    x: (Number.isFinite(box.x) ? box.x : 0) + box.width - width,
    y: Number.isFinite(box.y) ? box.y : 0,
    width,
    height: box.height,
  };
}
