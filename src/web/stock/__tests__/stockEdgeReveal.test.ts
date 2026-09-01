import { describe, expect, test } from 'vitest';

import {
  STOCK_EDGE_REVEAL_HOLD_MS,
  STOCK_EDGE_REVEAL_PX,
  shouldRevealStockAtBottomEdge,
  shouldRevealStockAtDockEdge,
} from '../stockEdgeReveal';

describe('shouldRevealStockAtDockEdge', () => {
  test('viewport 下端ゾーン内だけ true', () => {
    expect(shouldRevealStockAtDockEdge(719, 800, 'bottom')).toBe(false);
    expect(shouldRevealStockAtDockEdge(720, 800, 'bottom')).toBe(true);
    expect(shouldRevealStockAtDockEdge(800, 800, 'bottom')).toBe(true);
    expect(shouldRevealStockAtBottomEdge(719, 800)).toBe(false);
    expect(shouldRevealStockAtBottomEdge(720, 800)).toBe(true);
    expect(STOCK_EDGE_REVEAL_PX).toBe(80);
    expect(STOCK_EDGE_REVEAL_HOLD_MS).toBe(500);
  });

  test('viewport 上端ゾーン内だけ true', () => {
    expect(shouldRevealStockAtDockEdge(0, 800, 'top')).toBe(true);
    expect(shouldRevealStockAtDockEdge(80, 800, 'top')).toBe(true);
    expect(shouldRevealStockAtDockEdge(81, 800, 'top')).toBe(false);
  });
});
