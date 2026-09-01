import { describe, expect, test } from 'vitest';

import {
  STOCK_EDGE_REVEAL_HOLD_MS,
  STOCK_EDGE_REVEAL_PX,
  shouldRevealStockAtBottomEdge,
} from '../stockEdgeReveal';

describe('shouldRevealStockAtBottomEdge', () => {
  test('viewport 下端ゾーン内だけ true', () => {
    expect(shouldRevealStockAtBottomEdge(719, 800)).toBe(false);
    expect(shouldRevealStockAtBottomEdge(720, 800)).toBe(true);
    expect(shouldRevealStockAtBottomEdge(800, 800)).toBe(true);
    expect(STOCK_EDGE_REVEAL_PX).toBe(80);
    expect(STOCK_EDGE_REVEAL_HOLD_MS).toBe(500);
  });
});
