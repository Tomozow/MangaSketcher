import { describe, expect, test } from 'vitest';
import {
  STOCK_TEXT_THUMB_BASE_PX,
  STOCK_TEXT_THUMB_MIN_PX,
  fitStockTextThumbFontSize,
  stockTextThumbFitsBox,
} from '../stockTextThumbFit';

describe('fitStockTextThumbFontSize', () => {
  test('短い文は基準サイズのまま', () => {
    expect(fitStockTextThumbFontSize('あ', 48, 80)).toBe(STOCK_TEXT_THUMB_BASE_PX);
  });

  test('長い文は枠に収まるまで小さくする', () => {
    const long = 'あ'.repeat(80);
    const size = fitStockTextThumbFontSize(long, 48, 80);
    expect(size).toBeLessThan(STOCK_TEXT_THUMB_BASE_PX);
    expect(size).toBeGreaterThanOrEqual(STOCK_TEXT_THUMB_MIN_PX);
    expect(stockTextThumbFitsBox(long, 48, 80, size)).toBe(true);
  });
});
