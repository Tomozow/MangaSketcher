import { wrapPageTextToLines } from '../../domain/textWrap';
import { verticalGlyphs } from '../../domain/text';

/** Display-only base size for stock text thumbs. Does not write to document data. */
export const STOCK_TEXT_THUMB_BASE_PX = 12;
export const STOCK_TEXT_THUMB_MIN_PX = 5;

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

export function fitStockTextThumbFontSize(content: string, width: number, height: number): number {
  if (stockTextThumbFitsBox(content, width, height, STOCK_TEXT_THUMB_BASE_PX)) {
    return STOCK_TEXT_THUMB_BASE_PX;
  }
  let lo = STOCK_TEXT_THUMB_MIN_PX;
  let hi = STOCK_TEXT_THUMB_BASE_PX;
  let best = STOCK_TEXT_THUMB_MIN_PX;
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
