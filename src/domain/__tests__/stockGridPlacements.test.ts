import { describe, expect, test } from 'vitest';

import { STOCK_GRID_MIN_FIT_PAGE_UNITS, stockGridFitPageUnits, stockGridPlacements } from '../stockItems';
import type { StockItem } from '../types';

function page(id: string): StockItem {
  return { pageId: id, x: 0, y: 0 };
}

function clip(id: string): StockItem {
  return { kind: 'clip', clipId: id, x: 0, y: 0 };
}

describe('stockGridPlacements', () => {
  test('配列の先頭は右上、次が右下、余りは左上。末尾は左', () => {
    expect(stockGridPlacements([clip('a'), clip('b'), clip('c')])).toEqual([
      { column: 2, row: 1, rowSpan: 1 },
      { column: 2, row: 2, rowSpan: 1 },
      { column: 1, row: 1, rowSpan: 1 },
    ]);
  });

  test('後から入れたアイテムは左に付く', () => {
    expect(stockGridPlacements([clip('a'), page('p1')])).toEqual([
      { column: 1, row: 1, rowSpan: 1 },
      { column: 1, row: 2, rowSpan: 1 },
    ]);
  });

  test('ページも1段でクリップと同じ列に積む', () => {
    const items = [page('p1'), clip('a'), clip('b'), clip('c')];
    expect(stockGridPlacements(items)).toEqual([
      { column: 2, row: 1, rowSpan: 1 },
      { column: 2, row: 2, rowSpan: 1 },
      { column: 1, row: 1, rowSpan: 1 },
      { column: 1, row: 2, rowSpan: 1 },
    ]);
  });

  test('偶数個のクリップは右列から上→下で埋める', () => {
    expect(stockGridPlacements([clip('a'), clip('b'), clip('c'), clip('d')])).toEqual([
      { column: 2, row: 1, rowSpan: 1 },
      { column: 2, row: 2, rowSpan: 1 },
      { column: 1, row: 1, rowSpan: 1 },
      { column: 1, row: 2, rowSpan: 1 },
    ]);
  });

  test('フィット幅は1段列を半ページ幅で数える', () => {
    expect(stockGridFitPageUnits([])).toBe(0);
    expect(stockGridFitPageUnits([page('p1')])).toBe(0.5);
    expect(stockGridFitPageUnits([clip('a'), clip('b'), clip('c')])).toBe(1);
    expect(stockGridFitPageUnits([page('p1'), clip('a'), clip('b'), clip('c')])).toBe(1);
    expect(stockGridFitPageUnits([clip('a'), page('p1')])).toBe(0.5);
  });

  test('空のときのフィット下限はテキスト3列分（半ページ×3）', () => {
    expect(STOCK_GRID_MIN_FIT_PAGE_UNITS).toBe(1.5);
  });
});
