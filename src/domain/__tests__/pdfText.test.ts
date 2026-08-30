import { describe, expect, test } from 'vitest';

import {
  joinVerticalBody,
  snapReadingRangeToLines,
  sortBodyReadingOrder,
  verticalLineRanges,
} from '../pdfText';
import type { PdfTextItem } from '../types';

function glyph(str: string, x: number, y: number, fontSize = 9): PdfTextItem {
  return { str, x, y, width: fontSize, height: fontSize, fontSize };
}

describe('縦書き本文の読む順', () => {
  test('PDF 座標は y 上が上端なので、列内は y 降順（上から下）', () => {
    const items = [
      glyph('ト', 400, 178.6),
      glyph('ポ', 400, 206.2),
      glyph('ン', 400, 187.8),
      glyph('イ', 400, 197),
    ];
    expect(joinVerticalBody(items)).toBe('ポイント');
    expect(sortBodyReadingOrder(items).map((item) => item.str).join('')).toBe('ポイント');
  });

  test('右の列が先で、同じ列は上から下', () => {
    const items = [
      glyph('文', 200, 10),
      glyph('本', 200, 24),
      glyph('です', 180, 24),
    ];
    expect(joinVerticalBody(items)).toBe('本文です');
  });
});

describe('行スナップ', () => {
  test('同じ列の連続グリフは 1 行としてまとまる', () => {
    const col = ['家', '検', '探', 'ぶ', '選', 'を'].map((str, i) => glyph(str, 585, 200 - i * 9.2, 9.2));
    const sorted = sortBodyReadingOrder(col);
    expect(verticalLineRanges(sorted)).toEqual([{ start: 0, end: 5 }]);
    expect(snapReadingRangeToLines(sorted, 2, 2)).toEqual({ startIndex: 0, endIndex: 5 });
  });

  test('列が変わると行が分かれる', () => {
    const items = [
      ...['あ', 'い'].map((str, i) => glyph(str, 400, 200 - i * 9, 9)),
      ...['う', 'え'].map((str, i) => glyph(str, 380, 200 - i * 9, 9)),
    ];
    const sorted = sortBodyReadingOrder(items);
    expect(verticalLineRanges(sorted)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
    expect(snapReadingRangeToLines(sorted, 0, 3)).toEqual({ startIndex: 0, endIndex: 3 });
    expect(snapReadingRangeToLines(sorted, 1, 1)).toEqual({ startIndex: 0, endIndex: 1 });
  });
});
