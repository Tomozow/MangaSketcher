import { describe, expect, test } from 'vitest';

import { inkSizePreviewDiameterPx } from '../InkSizePreview';

describe('inkSizePreviewDiameterPx', () => {
  test('フル筆圧の線幅をページ表示スケール込みの画面ピクセルにする', () => {
    expect(inkSizePreviewDiameterPx(12, 1, 1200)).toBeCloseTo(12 * 2 * (216 / 1200));
    expect(inkSizePreviewDiameterPx(12, 2, 1200)).toBeCloseTo(12 * 2 * (216 / 1200) * 2);
    expect(inkSizePreviewDiameterPx(0.2, 1, 1200)).toBeCloseTo(0.5 * 2 * (216 / 1200));
  });
});
