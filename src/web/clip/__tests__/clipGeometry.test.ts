import { describe, expect, test } from 'vitest';

import {
  clipInsertTarget,
  clipTouchesWorldRect,
  clipWorldBounds,
  freeScaleFromCornerDrag,
  hitClipAt,
  normalizeMarqueeRect,
  polygonAabb,
  rectTouchesPolygon,
  scaleFromCornerDrag,
} from '../clipGeometry';
import { MIN_CLIP_SCALE } from '../constants';
import { PAGE_DISPLAY_H, PAGE_DISPLAY_W, type StripFrame } from '../../../domain/stripGeometry';

describe('clipGeometry', () => {
  test('normalizeMarqueeRect orders corners', () => {
    expect(normalizeMarqueeRect(10, 20, 4, 16)).toEqual({ x: 4, y: 16, width: 6, height: 4 });
  });

  test('polygonAabb is null below 3 points and otherwise spans the path', () => {
    expect(polygonAabb([{ x: 0, y: 0 }, { x: 4, y: 4 }])).toBeNull();
    expect(polygonAabb([{ x: 2, y: 8 }, { x: 10, y: 1 }, { x: 4, y: 4 }])).toEqual({
      x: 2,
      y: 1,
      width: 8,
      height: 7,
    });
  });

  test('rectTouchesPolygon selects boxes inside the lasso', () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 20 },
    ];
    expect(rectTouchesPolygon({ x: 2, y: 2, width: 4, height: 4 }, triangle)).toBe(true);
    expect(rectTouchesPolygon({ x: 16, y: 16, width: 4, height: 4 }, triangle)).toBe(false);
  });

  test('scaleFromCornerDrag respects MIN_CLIP_SCALE', () => {
    expect(scaleFromCornerDrag(1, 100, 1)).toBe(MIN_CLIP_SCALE);
    expect(scaleFromCornerDrag(1, 100, 150)).toBe(1.5);
  });

  test('freeScaleFromCornerDrag stretches axes independently with NW fixed', () => {
    const clip = { id: 'c1', x: 0, y: 0, scale: 1, rotation: 0 };
    const size = { width: 100, height: 100 };
    const bounds = clipWorldBounds(clip, size, 1200, 1700);
    const seX = bounds.cx + bounds.halfW;
    const seY = bounds.cy + bounds.halfH;
    const wide = freeScaleFromCornerDrag({
      startX: clip.x,
      startY: clip.y,
      startScaleX: 1,
      startScaleY: 1,
      startHalfW: bounds.halfW,
      startHalfH: bounds.halfH,
      rotation: 0,
      worldX: seX * 2,
      worldY: seY,
    });
    expect(wide.scale).toBeCloseTo(2);
    expect(wide.scaleY).toBeCloseTo(1);
    expect(wide.x).toBeCloseTo(0);
    expect(wide.y).toBeCloseTo(0);

    const tall = freeScaleFromCornerDrag({
      startX: clip.x,
      startY: clip.y,
      startScaleX: 1,
      startScaleY: 1,
      startHalfW: bounds.halfW,
      startHalfH: bounds.halfH,
      rotation: 0,
      worldX: seX,
      worldY: seY * 2,
    });
    expect(tall.scale).toBeCloseTo(1);
    expect(tall.scaleY).toBeCloseTo(2);
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

  test('clipTouchesWorldRect is true when the rect overlaps the clip', () => {
    const clip = { id: 'c1', x: 10, y: 20, scale: 1, rotation: 0 };
    const size = { width: 100, height: 50 };
    expect(clipTouchesWorldRect(clip, size, 1200, 1700, { x: 12, y: 22, width: 8, height: 8 })).toBe(true);
    expect(clipTouchesWorldRect(clip, size, 1200, 1700, { x: 400, y: 400, width: 10, height: 10 })).toBe(false);
  });

  test('clipInsertTarget requires origin and center on the same page', () => {
    const pageFrame: StripFrame = {
      key: 'p1',
      slot: { kind: 'page', pageId: 'p1', number: 1 },
      x: 0,
      y: 0,
      width: PAGE_DISPLAY_W,
      height: PAGE_DISPLAY_H,
      insertIndex: 0,
    };
    const onPage = { id: 'c1', x: 20, y: 20, scale: 1, rotation: 0 };
    const size = { width: 40, height: 40 };
    expect(clipInsertTarget(onPage, size, 1200, 1700, [pageFrame])?.pageId).toBe('p1');
    expect(clipInsertTarget({ ...onPage, x: 400, y: 20 }, size, 1200, 1700, [pageFrame])).toBeNull();
  });
});
