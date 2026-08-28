import { describe, expect, test } from 'vitest';

import {
  clipWorldBounds,
  hitClipAt,
  normalizeMarqueeRect,
  scaleFromCornerDrag,
} from '../clipGeometry';
import { MIN_CLIP_SCALE } from '../constants';

describe('clipGeometry', () => {
  test('normalizeMarqueeRect orders corners', () => {
    expect(normalizeMarqueeRect(10, 20, 4, 16)).toEqual({ x: 4, y: 16, width: 6, height: 4 });
  });

  test('scaleFromCornerDrag respects MIN_CLIP_SCALE', () => {
    expect(scaleFromCornerDrag(1, 100, 1)).toBe(MIN_CLIP_SCALE);
    expect(scaleFromCornerDrag(1, 100, 150)).toBe(1.5);
  });

  test('hitClipAt returns corner handle when selected', () => {
    const clip = { id: 'c1', x: 0, y: 0, scale: 1, rotation: 0 };
    const size = { width: 100, height: 100 };
    const bounds = clipWorldBounds(clip, size, 1200, 1700);
    const cornerWorldX = bounds.cx + bounds.halfW;
    const cornerWorldY = bounds.cy + bounds.halfH;
    expect(hitClipAt(cornerWorldX, cornerWorldY, clip, size, 1200, 1700, true)).toBe('corner');
  });

  test('hitClipAt body does not steal page marquee area outside clip', () => {
    const clip = { id: 'c1', x: 200, y: 200, scale: 1, rotation: 0 };
    const size = { width: 20, height: 20 };
    expect(hitClipAt(0, 0, clip, size, 1200, 1700, false)).toBeNull();
  });
});
