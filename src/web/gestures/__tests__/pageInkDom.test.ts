import { describe, expect, test } from 'vitest';

import { pageInkLocalFromFrameRect } from '../pageInkDom';

describe('pageInkLocalFromFrameRect', () => {
  test('maps client coords across the full page frame height', () => {
    const rect = {
      left: 100,
      top: 200,
      width: 216,
      height: 306,
      right: 316,
      bottom: 506,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    };

    const top = pageInkLocalFromFrameRect(rect, 208, 210, 1200, 1700);
    const mid = pageInkLocalFromFrameRect(rect, 208, 353, 1200, 1700);
    const bottom = pageInkLocalFromFrameRect(rect, 208, 506, 1200, 1700);

    expect(top.y).toBeLessThan(mid.y);
    expect(mid.y).toBeLessThan(bottom.y);
    expect(bottom.y).toBe(1700);
    expect(top.x).toBeGreaterThan(0);
    expect(bottom.x).toBe(top.x);
  });
});
