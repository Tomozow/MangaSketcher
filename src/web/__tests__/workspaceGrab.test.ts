import { describe, expect, test } from 'vitest';
import {
  isCrossPaneDragMove,
  reduceWorkspaceGrab,
  shouldAcceptCrossPanePointerEnd,
} from '../workspaceGrab';

describe('reduceWorkspaceGrab', () => {
  test('clip live + commit on the same up does not leave a grab', () => {
    const during = reduceWorkspaceGrab(null, [
      { type: 'clipTransformLive', clipId: 'c1', x: 10, y: 20 },
    ]);
    expect(during).toEqual({ clipId: 'c1' });
    expect(
      reduceWorkspaceGrab(during, [
        { type: 'clipTransformLive', clipId: 'c1', x: 12, y: 22 },
        { type: 'commitClipTransform', clipId: 'c1' },
      ]),
    ).toBeNull();
  });

  test('text live then commit clears grab', () => {
    const during = reduceWorkspaceGrab(null, [
      { type: 'textTransformLive', textId: 't1', x: 1, y: 2, pasteboard: true },
    ]);
    expect(during).toEqual({ textId: 't1' });
    expect(
      reduceWorkspaceGrab(during, [
        { type: 'commitTextTransform', textId: 't1', x: 3, y: 4, pasteboard: true },
      ]),
    ).toBeNull();
  });

  test('selection move commit and cancel clear grab', () => {
    const during = reduceWorkspaceGrab(null, [
      { type: 'beginSelectionMove', clipIds: ['c1'], textIds: ['t1'] },
    ]);
    expect(during?.clipIds).toEqual(['c1']);
    expect(reduceWorkspaceGrab(during, [{ type: 'commitSelectionMove' }])).toBeNull();
    expect(reduceWorkspaceGrab(during, [{ type: 'cancelSelectionMove' }])).toBeNull();
  });

  test('page grab is not cleared by clip commit', () => {
    const page = reduceWorkspaceGrab(null, [{ type: 'grabPage', pageId: 'p1', fromIndex: 0 }]);
    expect(
      reduceWorkspaceGrab(page, [
        { type: 'clipTransformLive', clipId: 'c1', x: 1, y: 1 },
        { type: 'commitClipTransform', clipId: 'c1' },
      ]),
    ).toEqual(page);
    expect(reduceWorkspaceGrab(page, [{ type: 'endGrabPage' }])).toBeNull();
  });
});

describe('shouldAcceptCrossPanePointerEnd', () => {
  test('workspace grab ignores pointerup that was not the armed drag', () => {
    expect(
      shouldAcceptCrossPanePointerEnd({
        hasWorkspaceGrab: true,
        stockDragging: false,
        trackedPointerId: null,
        eventPointerId: 1,
      }),
    ).toBe(false);
    expect(
      shouldAcceptCrossPanePointerEnd({
        hasWorkspaceGrab: true,
        stockDragging: false,
        trackedPointerId: 7,
        eventPointerId: 1,
      }),
    ).toBe(false);
    expect(
      shouldAcceptCrossPanePointerEnd({
        hasWorkspaceGrab: true,
        stockDragging: false,
        trackedPointerId: 7,
        eventPointerId: 7,
      }),
    ).toBe(true);
  });

  test('hover move with no buttons is not a drag', () => {
    expect(isCrossPaneDragMove({ buttons: 0 })).toBe(false);
    expect(isCrossPaneDragMove({ buttons: 1 })).toBe(true);
  });
});
