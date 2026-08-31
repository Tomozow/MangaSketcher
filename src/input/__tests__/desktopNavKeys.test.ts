import { describe, expect, test } from 'vitest';

import {
  desktopNavForPointer,
  desktopNavMode,
  resetDesktopNavKeys,
  setDesktopNavKeysForTest,
} from '../desktopNavKeys';

describe('desktopNavKeys', () => {
  test('space alone enables pan, with ctrl enables zoom', () => {
    resetDesktopNavKeys();
    expect(desktopNavMode()).toBe('none');

    setDesktopNavKeysForTest(true, false);
    expect(desktopNavMode()).toBe('pan');

    setDesktopNavKeysForTest(true, true);
    expect(desktopNavMode()).toBe('zoom');

    setDesktopNavKeysForTest(false, true);
    expect(desktopNavMode()).toBe('none');
  });

  test('right mouse button pans; Space+Ctrl still zooms', () => {
    resetDesktopNavKeys();
    const rightDown = { pointerType: 'mouse', button: 2, buttons: 2 } as PointerEvent;
    const rightMove = { pointerType: 'mouse', button: -1, buttons: 2 } as PointerEvent;
    const leftDown = { pointerType: 'mouse', button: 0, buttons: 1 } as PointerEvent;

    expect(desktopNavForPointer(rightDown, 'down')).toBe('pan');
    expect(desktopNavForPointer(rightMove, 'move')).toBe('pan');
    expect(desktopNavForPointer({ pointerType: 'mouse', button: 2, buttons: 0 } as PointerEvent, 'up')).toBe(
      'pan',
    );
    expect(desktopNavForPointer(leftDown, 'down')).toBe('none');

    setDesktopNavKeysForTest(true, true);
    expect(desktopNavForPointer(rightDown, 'down')).toBe('zoom');
  });
});
