import { EXTRACT_CHARS_PER_COL } from './pdfExtractPack';
import { isTextContentEmpty, verticalGlyphs } from './text';
import type { Rect } from './types';

/** Must match LINE_HEIGHT in src/web/ink/drawPageTextsOnThumb.ts (column width = fontPx * 1.2). */
export const TEXT_WRAP_LINE_HEIGHT = 1.2;
/** Must match the overflow epsilon in drawPageTextsOnThumb. */
export const TEXT_WRAP_EPSILON = 0.01;

function effectiveFontPx(fontSize: number): number {
  return Math.max(1, Number.isFinite(fontSize) ? fontSize : 12);
}

/**
 * Reproduce the app's vertical-writing auto-wrap (drawPageTextsOnThumb at raster
 * scale 1:1) as an explicit line split. Each returned string is one rendered
 * column (right to left). Glyphs the app never draws (columns clipped past the
 * box's left edge) are dropped here too, so the result matches what the user
 * sees on the page. Returns [] when the app would render nothing.
 */
export function wrapPageTextToLines(content: string, box: Rect, fontSize: number): string[] {
  if (isTextContentEmpty(content)) {
    return [];
  }
  if (box.width <= 0 || box.height <= 0) {
    return [];
  }

  const fontPx = effectiveFontPx(fontSize);
  const colW = fontPx * TEXT_WRAP_LINE_HEIGHT;
  let colX = box.x + box.width - colW;
  let y = box.y;
  const lines: string[] = [''];

  for (const glyph of verticalGlyphs(content)) {
    if (glyph === '\r') {
      continue;
    }
    const wrap = glyph === '\n' || y + fontPx > box.y + box.height + TEXT_WRAP_EPSILON;
    if (wrap) {
      colX -= colW;
      y = box.y;
      lines.push('');
      if (glyph === '\n') {
        continue;
      }
    }
    if (colX + colW < box.x) {
      // The renderer breaks before drawing anything in this column; the column
      // was just opened by the wrap above, so it is always still empty.
      lines.pop();
      break;
    }
    lines[lines.length - 1] += glyph;
    y += fontPx;
  }

  return lines;
}

/**
 * App text (auto-wrapped at draw time) → explicit CRLF newlines at the exact
 * wrap positions the app renders. Intended for exporting to formats without
 * an auto-wrap engine (CSP .clip text layers).
 */
export function convertWrapToExplicitNewlines(content: string, box: Rect, fontSize: number): string {
  return wrapPageTextToLines(content, box, fontSize).join('\r\n');
}

export function verticalTextContentSize(
  content: string,
  fontSize: number,
  charsPerCol = EXTRACT_CHARS_PER_COL,
): { width: number; height: number } {
  const fontPx = effectiveFontPx(fontSize);
  const colW = fontPx * TEXT_WRAP_LINE_HEIGHT;
  const wrapHeight = Math.max(fontPx, charsPerCol * fontPx);
  const lines = wrapPageTextToLines(
    content,
    { x: 0, y: 0, width: colW * 4096, height: wrapHeight },
    fontSize,
  );
  const columns = Math.max(1, lines.length);
  const maxGlyphs = Math.max(1, ...lines.map((line) => [...line].length));
  return {
    width: Math.ceil(columns * colW),
    height: Math.ceil(maxGlyphs * fontPx),
  };
}

/** Keep the top-right corner; grow/shrink so every glyph fits (vertical-rl). */
export function fitTextBoxToContent(box: Rect, content: string, fontSize: number): Rect {
  if (isTextContentEmpty(content)) {
    return box;
  }
  const size = verticalTextContentSize(content, fontSize);
  const right = (Number.isFinite(box.x) ? box.x : 0) + Math.max(0, box.width);
  const y = Number.isFinite(box.y) ? box.y : 0;
  return {
    x: right - size.width,
    y,
    width: size.width,
    height: size.height,
  };
}

