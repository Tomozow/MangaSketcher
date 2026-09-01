import { wrapPageTextToLines } from '../../domain/textWrap';
import { verticalGlyphs } from '../../domain/text';

/** Display-only base size for stock text thumbs. Does not write to document data. */
export const STOCK_TEXT_THUMB_BASE_PX = 12;
export const STOCK_TEXT_THUMB_MIN_PX = 5;
export const STOCK_TEXT_THUMB_FREE_BASE_PX = STOCK_TEXT_THUMB_BASE_PX / 2;
export const STOCK_TEXT_THUMB_FREE_MIN_PX = Math.max(1, Math.floor(STOCK_TEXT_THUMB_MIN_PX / 2));

function drawableGlyphCount(content: string): number {
  return verticalGlyphs(content).filter((glyph) => glyph !== '\r' && glyph !== '\n').length;
}

export function stockTextThumbFitsBox(content: string, width: number, height: number, fontSize: number): boolean {
  if (width <= 0 || height <= 0) {
    return false;
  }
  const needed = drawableGlyphCount(content);
  if (needed === 0) {
    return true;
  }
  const lines = wrapPageTextToLines(content, { x: 0, y: 0, width, height }, fontSize);
  let drawn = 0;
  for (const line of lines) {
    drawn += [...line].length;
  }
  return drawn >= needed;
}

export function fitStockTextThumbFontSize(
  content: string,
  width: number,
  height: number,
  limits?: { base?: number; min?: number },
): number {
  const base = limits?.base ?? STOCK_TEXT_THUMB_BASE_PX;
  const min = limits?.min ?? STOCK_TEXT_THUMB_MIN_PX;
  if (stockTextThumbFitsBox(content, width, height, base)) {
    return base;
  }
  let lo = min;
  let hi = base;
  let best = min;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (stockTextThumbFitsBox(content, width, height, mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
