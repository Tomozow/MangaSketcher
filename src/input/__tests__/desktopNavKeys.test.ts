import { describe, expect, test } from 'vitest';

import { desktopNavMode, resetDesktopNavKeys, setDesktopNavKeysForTest } from '../desktopNavKeys';

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
});
