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

/** Vertical Japanese: columns right-to-left, characters top-to-bottom. */
export function joinVerticalBody(items: readonly PdfTextItem[]): string {
  const body = stripRuby(items);
  const sorted = [...body].sort((a, b) => {
    const col = b.x - a.x;
    if (Math.abs(col) > Math.max(a.fontSize, b.fontSize) * 0.8) {
      return col;
    }
    return a.y - b.y;
  });
  return sorted.map((item) => item.str).join('').replace(/\s+/g, '');
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
