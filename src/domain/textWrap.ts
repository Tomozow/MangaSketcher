import { defaultTextBox, isTextContentEmpty, verticalGlyphs } from './text';
import type { Rect } from './types';

/** Column pitch in vertical-rl (must match CSS `line-height: 1.5` and canvas wrap). */
export const TEXT_WRAP_LINE_HEIGHT = 1.5;
/** Must match the overflow epsilon in drawPageTextsOnThumb. */
export const TEXT_WRAP_EPSILON = 0.01;

export function verticalColumnPitch(fontPx: number): number {
  return fontPx * TEXT_WRAP_LINE_HEIGHT;
}

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
  const colW = verticalColumnPitch(fontPx);
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

/** Insertion cell in vertical-rl (column 0 = rightmost). `utf16Index` is textarea selectionStart. */
export function verticalCaretCell(
  content: string,
  utf16Index: number,
  box: Rect,
  fontSize: number,
): { column: number; row: number } {
  const target = Math.max(0, Math.min(utf16Index, content.length));
  if (box.width <= 0 || box.height <= 0 || isTextContentEmpty(content)) {
    return { column: 0, row: 0 };
  }

  const fontPx = effectiveFontPx(fontSize);
  const colW = verticalColumnPitch(fontPx);
  let colX = box.x + box.width - colW;
  let y = box.y;
  let column = 0;
  let row = 0;
  let utf = 0;

  for (const glyph of verticalGlyphs(content)) {
    if (utf >= target) {
      return { column, row };
    }
    if (glyph === '\r') {
      utf += glyph.length;
      continue;
    }
    const wrap = glyph === '\n' || y + fontPx > box.y + box.height + TEXT_WRAP_EPSILON;
    if (wrap) {
      colX -= colW;
      y = box.y;
      column += 1;
      row = 0;
      if (glyph === '\n') {
        utf += glyph.length;
        continue;
      }
    }
    if (colX + colW < box.x) {
      return { column: Math.max(0, column - 1), row };
    }
    utf += glyph.length;
    y += fontPx;
    row += 1;
  }
  return { column, row };
}

/**
 * App text (auto-wrapped at draw time) → explicit CRLF newlines at the exact
 * wrap positions the app renders. Intended for exporting to formats without
 * an auto-wrap engine (CSP .clip text layers).
 */
export function convertWrapToExplicitNewlines(content: string, box: Rect, fontSize: number): string {
  return wrapPageTextToLines(content, expandTextBoxWidthToColumns(box, content, fontSize), fontSize).join('\r\n');
}

export function verticalTextContentSize(
  content: string,
  fontSize: number,
): { width: number; height: number } {
  const fontPx = effectiveFontPx(fontSize);
  const colW = verticalColumnPitch(fontPx);
  const lines = wrapPageTextToLines(
    content,
    { x: 0, y: 0, width: colW * 4096, height: fontPx * 65536 },
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

/** On-screen wrap and pointer hit: hug glyphs, ignore leftover balloon height. */
export function layoutVisibleTextBox(box: Rect, content: string, fontSize: number): Rect {
  if (isTextContentEmpty(content)) {
    const size = defaultTextBox(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, fontSize);
    const right = (Number.isFinite(box.x) ? box.x : 0) + Math.max(0, box.width);
    const y = Number.isFinite(box.y) ? box.y : 0;
    return { x: right - size.width, y, width: size.width, height: size.height };
  }
  return fitTextBoxToContent(box, content, fontSize);
}

/**
 * Grow width (keeping the right edge) so every column produced by wrapping
 * inside the current height fits. Used when CSS `line-height: 1.5` needs more
 * horizontal room than an older 1.2em-wide box.
 */
export function expandTextBoxWidthToColumns(box: Rect, content: string, fontSize: number): Rect {
  if (isTextContentEmpty(content)) {
    return box;
  }
  const fontPx = effectiveFontPx(fontSize);
  const colW = verticalColumnPitch(fontPx);
  const height = Math.max(0, Number.isFinite(box.height) ? box.height : 0);
  const width = Math.max(0, Number.isFinite(box.width) ? box.width : 0);
  if (width <= 0 || height <= 0) {
    return box;
  }
  const lines = wrapPageTextToLines(
    content,
    { x: 0, y: 0, width: colW * 4096, height },
    fontSize,
  );
  const needed = Math.ceil(Math.max(1, lines.length) * colW);
  if (needed <= width + 0.01) {
    return box;
  }
  const right = (Number.isFinite(box.x) ? box.x : 0) + width;
  return { ...box, x: right - needed, width: needed };
}

