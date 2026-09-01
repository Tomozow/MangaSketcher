import { describe, expect, test } from 'vitest';
import {
  clampOverlayBox,
  intersectOverlayBoxes,
  subtractHorizontalObstacle,
} from '../overlayClamp';

describe('overlayClamp', () => {
  test('intersectOverlayBoxes returns the overlap', () => {
    expect(
      intersectOverlayBoxes(
        { left: 0, top: 0, width: 100, height: 80 },
        { left: 60, top: 10, width: 80, height: 40 },
      ),
    ).toEqual({ left: 60, top: 10, width: 40, height: 40 });
  });

  test('subtractHorizontalObstacle insets from the overlapping side', () => {
    const view = { left: 0, top: 0, width: 400, height: 300 };
    const leftRail = { left: 0, top: 40, width: 60, height: 200 };
    expect(subtractHorizontalObstacle(view, leftRail)).toEqual({
      left: 60,
      top: 0,
      width: 340,
      height: 300,
    });
    const rightRail = { left: 340, top: 40, width: 60, height: 200 };
    expect(subtractHorizontalObstacle(view, rightRail)).toEqual({
      left: 0,
      top: 0,
      width: 340,
      height: 300,
    });
  });

  test('clampOverlayBox keeps a box inside the view with margin', () => {
    const view = { left: 0, top: 0, width: 200, height: 100 };
    expect(
      clampOverlayBox({ left: -40, top: -10, width: 80, height: 32 }, view, 6),
    ).toEqual({ left: 6, top: 6, width: 80, height: 32 });
    expect(
      clampOverlayBox({ left: 180, top: 90, width: 80, height: 32 }, view, 6),
    ).toEqual({ left: 114, top: 62, width: 80, height: 32 });
  });

  test('clampOverlayBox shrinks when the box is wider than the view', () => {
    const view = { left: 10, top: 10, width: 100, height: 80 };
    const clamped = clampOverlayBox({ left: 0, top: 0, width: 240, height: 40 }, view, 6);
    expect(clamped.width).toBe(88);
    expect(clamped.left).toBe(16);
  });
});
