import type { PdfTextItem } from './types';

const RUBY_ROLES = new Set(['Ruby', 'Rt', 'RP', 'ruby', 'rt']);

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/** Strip ruby (furigana). Body text only. Does not mutate source items. */
export function stripRuby(items: readonly PdfTextItem[]): PdfTextItem[] {
  const cloned = items.map((item) => ({ ...item }));
  const withRole = cloned.filter((item) => item.role && RUBY_ROLES.has(item.role));
  if (withRole.length > 0) {
    return cloned.filter((item) => !item.role || !RUBY_ROLES.has(item.role));
  }

  const sizes = cloned.map((item) => item.fontSize).filter((s) => s > 0);
  const mid = median(sizes);
  if (mid <= 0) {
    return cloned.filter((item) => item.str.trim().length > 0);
  }
  return cloned.filter((item) => {
    if (item.str.trim().length === 0) {
      return false;
    }
    return item.fontSize >= mid * 0.72;
  });
}

export function sortBodyReadingOrder(items: readonly PdfTextItem[]): PdfTextItem[] {
  const body = stripRuby(items);
  return [...body].sort((a, b) => {
    const col = b.x - a.x;
    if (Math.abs(col) > Math.max(a.fontSize, b.fontSize) * 0.8) {
      return col;
    }
    // PDF space is y-up: larger y is visually higher, so top-to-bottom is y descending.
    return b.y - a.y;
  });
}

/** Consecutive same-column glyphs (or a single PDF.js run) as one vertical line (行). */
export function verticalLineRanges(
  sorted: readonly PdfTextItem[],
): Array<{ start: number; end: number }> {
  if (sorted.length === 0) {
    return [];
  }
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const em = Math.max(1, prev.fontSize || 1, cur.fontSize || 1);
    const newCol = Math.abs(cur.x - prev.x) > em * 0.8;
    const gap = Math.abs(cur.y - prev.y) > em * 1.8;
    if (newCol || gap) {
      ranges.push({ start, end: i - 1 });
      start = i;
    }
  }
  ranges.push({ start, end: sorted.length - 1 });
  return ranges;
}

/** Expand a glyph index range to whole vertical lines. Handle adjust should not use this. */
export function snapReadingRangeToLines(
  sorted: readonly PdfTextItem[],
  startIndex: number,
  endIndex: number,
): { startIndex: number; endIndex: number } {
  const ranges = verticalLineRanges(sorted);
  if (ranges.length === 0) {
    return {
      startIndex: Math.min(startIndex, endIndex),
      endIndex: Math.max(startIndex, endIndex),
    };
  }
  const lo = Math.min(startIndex, endIndex);
  const hi = Math.max(startIndex, endIndex);
  const startLine = ranges.find((range) => lo >= range.start && lo <= range.end) ?? ranges[0];
  const endLine = ranges.find((range) => hi >= range.start && hi <= range.end) ?? ranges[ranges.length - 1];
  return {
    startIndex: Math.min(startLine.start, endLine.start),
    endIndex: Math.max(startLine.end, endLine.end),
  };
}

/** Vertical Japanese: columns right-to-left, characters top-to-bottom. */
export function joinVerticalBody(items: readonly PdfTextItem[]): string {
  return sortBodyReadingOrder(items)
    .map((item) => item.str)
    .join('')
    .replace(/\s+/g, '');
}

/** Drop 「」 and turn 、。 into ASCII spaces. Does not mutate source glyphs. */
export function sanitizeExtractedBody(text: string): string {
  return text
    .replace(/[「」]/g, '')
    .replace(/[、。]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function sliceReadingRange(
  sorted: readonly PdfTextItem[],
  startIndex: number,
  endIndex: number,
): PdfTextItem[] {
  if (sorted.length === 0) {
    return [];
  }
  const lo = Math.max(0, Math.min(startIndex, endIndex));
  const hi = Math.min(sorted.length - 1, Math.max(startIndex, endIndex));
  return sorted.slice(lo, hi + 1);
}

export function rangeSelectBody(
  items: readonly PdfTextItem[],
  rect: { x: number; y: number; width: number; height: number },
): PdfTextItem[] {
  const body = stripRuby(items);
  return body.filter(
    (item) =>
      item.x < rect.x + rect.width &&
      item.x + item.width > rect.x &&
      item.y < rect.y + rect.height &&
      item.y + item.height > rect.y,
  );
}
