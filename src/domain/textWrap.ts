import { defaultTextBox, isTextContentEmpty, verticalGlyphs } from './text';
import type { Rect, WritingMode } from './types';
import { writingModeOf } from './types';

/** Column pitch in vertical-rl (CSS `line-height: 1.5`). */
export const TEXT_WRAP_LINE_HEIGHT = 1.5;
/** Row pitch in horizontal-tb (CSS `line-height: 1.2`). */
export const TEXT_WRAP_HORIZONTAL_LINE_HEIGHT = 1.2;
/** Must match the overflow epsilon in drawPageTextsOnThumb. */
export const TEXT_WRAP_EPSILON = 0.01;

export function verticalColumnPitch(fontPx: number): number {
  return fontPx * TEXT_WRAP_LINE_HEIGHT;
}

export function horizontalRowPitch(fontPx: number): number {
  return fontPx * TEXT_WRAP_HORIZONTAL_LINE_HEIGHT;
}

function effectiveFontPx(fontSize: number): number {
  return Math.max(1, Number.isFinite(fontSize) ? fontSize : 12);
}

function wrapVerticalToLines(content: string, box: Rect, fontSize: number): string[] {
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
      lines.pop();
      break;
    }
    lines[lines.length - 1] += glyph;
    y += fontPx;
  }

  return lines;
}

function wrapHorizontalToLines(content: string, box: Rect, fontSize: number): string[] {
  const fontPx = effectiveFontPx(fontSize);
  const rowH = horizontalRowPitch(fontPx);
  let x = box.x;
  let y = box.y;
  const lines: string[] = [''];

  for (const glyph of verticalGlyphs(content)) {
    if (glyph === '\r') {
      continue;
    }
    const wrap = glyph === '\n' || x + fontPx > box.x + box.width + TEXT_WRAP_EPSILON;
    if (wrap) {
      y += rowH;
      x = box.x;
      lines.push('');
      if (glyph === '\n') {
        continue;
      }
    }
    if (y + rowH < box.y || y + fontPx > box.y + box.height + TEXT_WRAP_EPSILON) {
      lines.pop();
      break;
    }
    lines[lines.length - 1] += glyph;
    x += fontPx;
  }

  return lines;
}

/**
 * Auto-wrap matching drawPageTextsOnThumb. Vertical: each string is a column
 * (right to left). Horizontal: each string is a row (top to bottom).
 */
export function wrapPageTextToLines(
  content: string,
  box: Rect,
  fontSize: number,
  writingMode: WritingMode = 'vertical',
): string[] {
  if (isTextContentEmpty(content)) {
    return [];
  }
  if (box.width <= 0 || box.height <= 0) {
    return [];
  }
  return writingModeOf(writingMode) === 'horizontal'
    ? wrapHorizontalToLines(content, box, fontSize)
    : wrapVerticalToLines(content, box, fontSize);
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

/** Insertion cell in horizontal-tb (row 0 = top). */
export function horizontalCaretCell(
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
  const rowH = horizontalRowPitch(fontPx);
  let x = box.x;
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
    const wrap = glyph === '\n' || x + fontPx > box.x + box.width + TEXT_WRAP_EPSILON;
    if (wrap) {
      y += rowH;
      x = box.x;
      row += 1;
      column = 0;
      if (glyph === '\n') {
        utf += glyph.length;
        continue;
      }
    }
    if (y + fontPx > box.y + box.height + TEXT_WRAP_EPSILON) {
      return { column, row: Math.max(0, row - 1) };
    }
    utf += glyph.length;
    x += fontPx;
    column += 1;
  }
  return { column, row };
}

export function textCaretCell(
  content: string,
  utf16Index: number,
  box: Rect,
  fontSize: number,
  writingMode: WritingMode = 'vertical',
): { column: number; row: number } {
  return writingModeOf(writingMode) === 'horizontal'
    ? horizontalCaretCell(content, utf16Index, box, fontSize)
    : verticalCaretCell(content, utf16Index, box, fontSize);
}

export function convertWrapToExplicitNewlines(
  content: string,
  box: Rect,
  fontSize: number,
  writingMode: WritingMode = 'vertical',
): string {
  return wrapPageTextToLines(
    content,
    expandTextBoxWidthToColumns(box, content, fontSize, writingMode),
    fontSize,
    writingMode,
  ).join('\r\n');
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
    'vertical',
  );
  const columns = Math.max(1, lines.length);
  const maxGlyphs = Math.max(1, ...lines.map((line) => [...line].length));
  return {
    width: Math.ceil(columns * colW),
    height: Math.ceil(maxGlyphs * fontPx),
  };
}

export function horizontalTextContentSize(
  content: string,
  fontSize: number,
): { width: number; height: number } {
  const fontPx = effectiveFontPx(fontSize);
  const rowH = horizontalRowPitch(fontPx);
  const lines = wrapPageTextToLines(
    content,
    { x: 0, y: 0, width: fontPx * 65536, height: rowH * 4096 },
    fontSize,
    'horizontal',
  );
  const rows = Math.max(1, lines.length);
  const maxGlyphs = Math.max(1, ...lines.map((line) => [...line].length));
  return {
    width: Math.ceil(maxGlyphs * fontPx),
    height: Math.ceil(rows * rowH),
  };
}

export function textContentSize(
  content: string,
  fontSize: number,
  writingMode: WritingMode = 'vertical',
): { width: number; height: number } {
  return writingModeOf(writingMode) === 'horizontal'
    ? horizontalTextContentSize(content, fontSize)
    : verticalTextContentSize(content, fontSize);
}

/** Vertical keeps top-right; horizontal keeps top-left. */
export function fitTextBoxToContent(
  box: Rect,
  content: string,
  fontSize: number,
  writingMode: WritingMode = 'vertical',
): Rect {
  if (isTextContentEmpty(content)) {
    return box;
  }
  const size = textContentSize(content, fontSize, writingMode);
  const y = Number.isFinite(box.y) ? box.y : 0;
  if (writingModeOf(writingMode) === 'horizontal') {
    const x = Number.isFinite(box.x) ? box.x : 0;
    return { x, y, width: size.width, height: size.height };
  }
  const right = (Number.isFinite(box.x) ? box.x : 0) + Math.max(0, box.width);
  return {
    x: right - size.width,
    y,
    width: size.width,
    height: size.height,
  };
}

export function layoutVisibleTextBox(
  box: Rect,
  content: string,
  fontSize: number,
  writingMode: WritingMode = 'vertical',
): Rect {
  const mode = writingModeOf(writingMode);
  if (isTextContentEmpty(content)) {
    const size = defaultTextBox(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, fontSize, mode);
    const y = Number.isFinite(box.y) ? box.y : 0;
    if (mode === 'horizontal') {
      const x = Number.isFinite(box.x) ? box.x : 0;
      return { x, y, width: size.width, height: size.height };
    }
    const right = (Number.isFinite(box.x) ? box.x : 0) + Math.max(0, box.width);
    return { x: right - size.width, y, width: size.width, height: size.height };
  }
  return fitTextBoxToContent(box, content, fontSize, mode);
}

/**
 * Grow the wrap axis so every line produced inside the other axis fits.
 * Vertical grows width (right edge fixed). Horizontal grows height (top fixed).
 */
export function expandTextBoxWidthToColumns(
  box: Rect,
  content: string,
  fontSize: number,
  writingMode: WritingMode = 'vertical',
): Rect {
  if (isTextContentEmpty(content)) {
    return box;
  }
  const fontPx = effectiveFontPx(fontSize);
  const height = Math.max(0, Number.isFinite(box.height) ? box.height : 0);
  const width = Math.max(0, Number.isFinite(box.width) ? box.width : 0);
  if (width <= 0 || height <= 0) {
    return box;
  }
  const mode = writingModeOf(writingMode);
  if (mode === 'horizontal') {
    const rowH = horizontalRowPitch(fontPx);
    const lines = wrapPageTextToLines(
      content,
      { x: 0, y: 0, width, height: rowH * 4096 },
      fontSize,
      'horizontal',
    );
    const needed = Math.ceil(Math.max(1, lines.length) * rowH);
    if (needed <= height + 0.01) {
      return box;
    }
    return { ...box, height: needed };
  }
  const colW = verticalColumnPitch(fontPx);
  const lines = wrapPageTextToLines(
    content,
    { x: 0, y: 0, width: colW * 4096, height },
    fontSize,
    'vertical',
  );
  const needed = Math.ceil(Math.max(1, lines.length) * colW);
  if (needed <= width + 0.01) {
    return box;
  }
  const right = (Number.isFinite(box.x) ? box.x : 0) + width;
  return { ...box, x: right - needed, width: needed };
}
