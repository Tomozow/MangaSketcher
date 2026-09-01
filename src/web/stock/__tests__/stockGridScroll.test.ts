import { describe, expect, test, vi } from 'vitest';

import { scrollStockGridToBack, snapStockGridToPackedEnd } from '../stockGridScroll';

describe('scrollStockGridToBack', () => {
  test('scrolls the newest thumb into view at the start of the scroller', () => {
    const scrollIntoView = vi.fn();
    const thumb = { scrollIntoView };
    const surface = {
      scrollLeft: 80,
      querySelector: (selector: string) => (selector.includes('clip:abc') ? thumb : null),
    };
    scrollStockGridToBack(surface as unknown as HTMLElement, 'clip:abc');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'start' });
    expect(surface.scrollLeft).toBe(80);
  });

  test('falls back to the left edge when the thumb is missing', () => {
    const surface = {
      scrollLeft: 40,
      querySelector: () => null,
    };
    scrollStockGridToBack(surface as unknown as HTMLElement, 'clip:missing');
    expect(surface.scrollLeft).toBe(0);
  });

  test('snaps packed grid to the right edge and clears vertical scroll', () => {
    const surface = {
      scrollLeft: 0,
      scrollTop: 48,
      scrollWidth: 400,
      clientWidth: 120,
    };
    snapStockGridToPackedEnd(surface as unknown as HTMLElement);
    expect(surface.scrollLeft).toBe(280);
    expect(surface.scrollTop).toBe(0);
  });
});
