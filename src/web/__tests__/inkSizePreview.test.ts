import { describe, expect, test } from 'vitest';

import { inkSizePreviewDiameterPx } from '../InkSizePreview';

describe('inkSizePreviewDiameterPx', () => {
  test('フル筆圧の線幅を画面ピクセルにする', () => {
    expect(inkSizePreviewDiameterPx(12, 1)).toBe(24);
    expect(inkSizePreviewDiameterPx(12, 2)).toBe(48);
    expect(inkSizePreviewDiameterPx(0.2, 1)).toBe(1);
  });
});
