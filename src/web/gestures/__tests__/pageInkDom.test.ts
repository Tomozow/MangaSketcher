import { describe, expect, test } from 'vitest';

import { PAGE_INK_FRAME_ATTR, pageInkLocalFromFrameRect, resolvePageDomHit } from '../pageInkDom';

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

describe('resolvePageDomHit rect iteration', () => {
  test('finds page when pointer is over frame rect but elementFromPoint misses', () => {
    const pageFrameEl = {
      getAttribute: (name: string) => (name === PAGE_INK_FRAME_ATTR ? 'p1' : null),
      getBoundingClientRect: () =>
        ({
          left: 100,
          top: 200,
          width: 216,
          height: 306,
          right: 316,
          bottom: 506,
          x: 100,
          y: 200,
          toJSON: () => ({}),
        }) as DOMRect,
    } as unknown as HTMLElement;

    const surfaceEl = {
      getBoundingClientRect: () =>
        ({
          left: 0,
          top: 0,
          width: 2000,
          height: 3000,
          right: 2000,
          bottom: 3000,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
      contains: () => true,
      querySelectorAll: (selector: string) => {
        if (selector.includes(PAGE_INK_FRAME_ATTR)) {
          return [pageFrameEl];
        }
        return [];
      },
    } as unknown as HTMLElement;

    const hit = resolvePageDomHit({
      clientX: 208,
      clientY: 353,
      surfaceEl,
      workspaceOrder: ['p1'],
      pages: { p1: { texts: [] } },
      rasterWidth: 1200,
      rasterHeight: 1700,
    });

    expect(hit?.kind).toBe('page');
    if (hit?.kind === 'page') {
      expect(hit.pageId).toBe('p1');
      expect(hit.localX).toBeGreaterThan(0);
      expect(hit.localY).toBeGreaterThan(0);
    }
  });
});
