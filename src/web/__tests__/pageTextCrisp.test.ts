import { describe, expect, test } from 'vitest';

import { pageTextCrispZoom, textWrapEmStyle } from '../PageTextOverlay';

describe('pageTextCrispZoom', () => {
  test('only the selected spread counters workspace scale above 1', () => {
    expect(pageTextCrispZoom(2.4, false)).toBe(1);
    expect(pageTextCrispZoom(2.4, true)).toBe(2.4);
    expect(pageTextCrispZoom(1, true)).toBe(1);
    expect(pageTextCrispZoom(0.5, true)).toBe(1);
    expect(pageTextCrispZoom(Number.NaN, true)).toBe(1);
  });
});

describe('textWrapEmStyle', () => {
  const box = { x: 100, y: 200, width: 40, height: 80 };

  test('zoom 1 keeps display font and no inverse scale', () => {
    const style = textWrapEmStyle(box, 40, 7.2, 1200, 1700, 1);
    expect(style.fontSize).toBe(7.2);
    expect(style.transform).toBeUndefined();
  });

  test('selected-spread zoom rasterizes glyphs then inverse-scales the wrap', () => {
    const style = textWrapEmStyle(box, 40, 7.2, 1200, 1700, 2);
    expect(style.fontSize).toBe(14.4);
    expect(style.transform).toBe('scale(0.5)');
    expect(style.transformOrigin).toBe('0 0');
    expect(style['--ms-screen-px' as string]).toBe('1');
  });
});
