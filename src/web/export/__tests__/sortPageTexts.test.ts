import { describe, expect, test } from 'vitest';
import type { PageText } from '../../../domain/types';
import { comparePageTextOrder, sortPageTexts } from '../sortPageTexts';

function text(id: string, x: number, y: number, width: number, height: number): PageText {
  return {
    id,
    content: id,
    box: { x, y, width, height },
    fontSize: 12,
    color: '#000',
  };
}

describe('comparePageTextOrder', () => {
  test('spec A/B/C numeric example', () => {
    const a = text('A', 900, 100, 80, 400);
    const b = text('B', 700, 50, 80, 400);
    const c = text('C', 700, 500, 80, 200);
    const sorted = sortPageTexts([c, b, a]);
    expect(sorted.map((item) => item.id)).toEqual(['A', 'B', 'C']);
  });

  test('right edge only decides first key', () => {
    const left = text('L', 100, 10, 10, 10);
    const right = text('R', 200, 10, 10, 10);
    expect(comparePageTextOrder(left, right, 0, 1)).toBeGreaterThan(0);
  });

  test('equal right uses y ascending', () => {
    const upper = text('U', 700, 50, 80, 10);
    const lower = text('D', 700, 500, 80, 10);
    expect(comparePageTextOrder(upper, lower, 0, 1)).toBeLessThan(0);
  });

  test('equal right and y uses original index', () => {
    const first = text('1', 10, 10, 10, 10);
    const second = text('2', 10, 10, 10, 10);
    expect(comparePageTextOrder(first, second, 4, 9)).toBeLessThan(0);
    expect(sortPageTexts([second, first]).map((item) => item.id)).toEqual(['2', '1']);
  });
});
