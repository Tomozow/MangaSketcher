import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from './stripGeometry';
import type { Rect } from './types';

export const EXTRACT_TEXT_HEIGHT = PAGE_DISPLAY_H;
export const EXTRACT_CHARS_PER_COL = 10;
/** Matches workspace `lineHeight: 1.2` (column pitch in vertical-rl). */
export const EXTRACT_LINE_HEIGHT = 1.2;
export const EXTRACT_GAP = 8;
export const EXTRACT_MARGIN_CSS = 16;

/** Vertical-rl: insert a column break every 10 characters. Keeps ASCII spaces; strips other whitespace. Idempotent if already wrapped. */
export function wrapExtractedText(
  content: string,
  charsPerCol = EXTRACT_CHARS_PER_COL,
): string {
  const limit = Math.max(1, charsPerCol);
  const chars = [...content.replace(/[^\S ]+/g, '')];
  if (chars.length === 0) {
    return '';
  }
  const columns: string[] = [];
  for (let i = 0; i < chars.length; i += limit) {
    columns.push(chars.slice(i, i + limit).join(''));
  }
  return columns.join('\n');
}

/** Map text-tool font (page raster px) to workspace CSS, matching on-page rendering. */
export function workspaceFontSizeFromTool(toolFontSize: number, rasterWidth: number): number {
  return Math.max(1, toolFontSize * (PAGE_DISPLAY_W / Math.max(1, rasterWidth)));
}

/** Page-raster text box → pasteboard world pixels. Font stays raster; overlay applies PAGE_DISPLAY_W/rasterWidth. */
export function pageTextToPasteboard(
  box: Rect,
  fontSize: number,
  rasterWidth: number,
  rasterHeight: number,
): { box: Rect; fontSize: number } {
  const rw = Math.max(1, rasterWidth);
  const rh = Math.max(1, rasterHeight);
  return {
    box: {
      x: box.x,
      y: box.y,
      width: (Math.max(0, box.width) / rw) * PAGE_DISPLAY_W,
      height: (Math.max(0, box.height) / rh) * PAGE_DISPLAY_H,
    },
    fontSize,
  };
}

export type ExtractPackCursor = {
  originRight: number;
  originTop: number;
  rowLeftLimit: number;
  rowTop: number;
  lastBox: Rect;
};

export type ViewportWorld = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  zoom: number;
};

/** Columns after 10-character wraps. No cap — 3, 4, … keep going. */
export function extractedColumnCount(
  content: string,
  charsPerCol = EXTRACT_CHARS_PER_COL,
): number {
  const wrapped = wrapExtractedText(content, charsPerCol);
  if (!wrapped) {
    return 1;
  }
  return Math.max(1, wrapped.split('\n').length);
}

/**
 * Vertical-rl: height is 10 characters; width follows the final column count.
 * Ceil so fractional pitches (e.g. 24×1.2 = 28.8) are not snapped smaller than
 * a line box — that clips a few CSS px on the left for odd column counts.
 */
export function extractedTextBoxSize(
  content: string,
  fontSize: number,
  charsPerCol = EXTRACT_CHARS_PER_COL,
): { width: number; height: number } {
  const size = Math.max(1, fontSize);
  const perCol = Math.max(1, charsPerCol);
  const columns = extractedColumnCount(content, perCol);
  const colPitch = size * EXTRACT_LINE_HEIGHT;
  return {
    width: Math.ceil(columns * colPitch),
    height: Math.ceil(perCol * colPitch),
  };
}

export function startExtractPack(
  viewport: ViewportWorld,
  size: { width: number; height: number },
): { box: Rect; cursor: ExtractPackCursor } {
  const margin = EXTRACT_MARGIN_CSS / Math.max(0.01, viewport.zoom);
  const viewW = viewport.right - viewport.left;
  const viewH = viewport.bottom - viewport.top;
  let x = viewport.left + (viewW - size.width) / 2;
  let y = viewport.top + (viewH - size.height) / 2;
  if (size.width + margin * 2 <= viewW) {
    x = Math.min(Math.max(x, viewport.left + margin), viewport.right - margin - size.width);
  }
  if (size.height + margin * 2 <= viewH) {
    y = Math.min(Math.max(y, viewport.top + margin), viewport.bottom - margin - size.height);
  }
  const originRight = x + size.width;
  const originTop = y;
  const rowLeftLimit = viewport.left + margin;
  const box: Rect = {
    x,
    y,
    width: size.width,
    height: size.height,
  };
  return {
    box,
    cursor: {
      originRight,
      originTop,
      rowLeftLimit,
      rowTop: originTop,
      lastBox: { ...box },
    },
  };
}

export function nextExtractPack(
  cursor: ExtractPackCursor,
  size: { width: number; height: number },
): { box: Rect; cursor: ExtractPackCursor } {
  const candidateX = cursor.lastBox.x - EXTRACT_GAP - size.width;
  let rowTop = cursor.rowTop;
  let box: Rect;
  if (candidateX < cursor.rowLeftLimit) {
    rowTop = cursor.rowTop + EXTRACT_TEXT_HEIGHT + EXTRACT_GAP;
    box = {
      x: cursor.originRight - size.width,
      y: rowTop,
      width: size.width,
      height: size.height,
    };
  } else {
    box = {
      x: candidateX,
      y: rowTop,
      width: size.width,
      height: size.height,
    };
  }
  return {
    box,
    cursor: {
      ...cursor,
      rowTop,
      lastBox: { ...box },
    },
  };
}
