import { describe, expect, test } from 'vitest';
import { appShellHeight } from '../appShellHeight';
import { MARK_STANDALONE_SCRIPT, STANDALONE_HTML_ATTR } from '../displayMode';

describe('appShellHeight', () => {
  test('Safari tab uses visual viewport so the address bar is not covered', () => {
    expect(
      appShellHeight({
        innerHeight: 1080,
        visualHeight: 1030,
        visualOffsetTop: 0,
        standalone: false,
      }),
    ).toBe(1030);
  });

  test('home-screen standalone leaves height unset so CSS 100lvh can fill', () => {
    expect(
      appShellHeight({
        innerHeight: 992,
        visualHeight: 992,
        visualOffsetTop: 0,
        standalone: true,
      }),
    ).toBeNull();
  });

  test('keyboard-sized visual shrink does not collapse the editor shell', () => {
    expect(
      appShellHeight({
        innerHeight: 934,
        visualHeight: 450,
        visualOffsetTop: 0,
        standalone: false,
      }),
    ).toBe(934);
    expect(
      appShellHeight({
        innerHeight: 1080,
        visualHeight: 620,
        visualOffsetTop: 0,
        standalone: true,
      }),
    ).toBeNull();
  });

  test('text editing keeps the layout viewport instead of shrinking for the keyboard', () => {
    expect(
      appShellHeight({
        innerHeight: 934,
        visualHeight: 450,
        visualOffsetTop: 0,
        standalone: false,
        ignoreVisualKeyboard: true,
      }),
    ).toBe(934);
    expect(
      appShellHeight({
        innerHeight: 1080,
        visualHeight: 620,
        visualOffsetTop: 0,
        standalone: true,
        ignoreVisualKeyboard: true,
      }),
    ).toBeNull();
  });
});

describe('standalone html mark', () => {
  test('head script sets data-ms-display before paint', () => {
    expect(MARK_STANDALONE_SCRIPT).toContain(STANDALONE_HTML_ATTR);
    expect(MARK_STANDALONE_SCRIPT).toContain('n.standalone');
    expect(MARK_STANDALONE_SCRIPT).toContain('display-mode: standalone');
  });
});
