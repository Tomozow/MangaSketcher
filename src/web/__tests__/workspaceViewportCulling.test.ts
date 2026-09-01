import { describe, expect, test } from 'vitest';

import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from '@/src/domain/stripGeometry';
import {
  cullWorkspaceInkRasters,
  inflateWorldAabb,
  pageInkWorldAabb,
  workspaceCellPad,
  workspaceSurfaceWorldAabb,
  worldAabbsIntersect,
} from '@/src/web/workspaceViewportCulling';

describe('workspaceViewportCulling', () => {
  test('maps the surface rectangle through screenToWorld', () => {
    const view = workspaceSurfaceWorldAabb(400, 300, 10, 20, 2);
    expect(view).toEqual({
      minX: (0 - 10) / 2,
      minY: (0 - 20) / 2,
      maxX: (400 - 10) / 2,
      maxY: (300 - 20) / 2,
    });
  });

  test('does not treat a zero-sized surface as the whole strip', () => {
    expect(workspaceSurfaceWorldAabb(0, 400, 0, 0, 1)).toBeNull();
    const empty = cullWorkspaceInkRasters({
      surfaceWidth: 0,
      surfaceHeight: 400,
      panX: 0,
      panY: 0,
      zoom: 1,
      pages: [{ rasterId: 'p', aabb: pageInkWorldAabb({ x: 0, y: 0, width: PAGE_DISPLAY_W }) }],
      clips: [],
      alwaysDisplayRasterIds: ['keep'],
    });
    expect(empty.displayRasterIds).toEqual(['keep']);
    expect(empty.pinRasterIds).toEqual(['keep']);
  });

  test('display is viewport plus one cell; pin is a further cell and contains display', () => {
    const near = pageInkWorldAabb({ x: 0, y: 0, width: PAGE_DISPLAY_W });
    const far = pageInkWorldAabb({
      x: 0,
      y: PAGE_DISPLAY_H * 20,
      width: PAGE_DISPLAY_W,
    });
    const result = cullWorkspaceInkRasters({
      surfaceWidth: 400,
      surfaceHeight: 400,
      panX: 0,
      panY: 0,
      zoom: 1,
      pages: [
        { rasterId: 'near', aabb: near },
        { rasterId: 'far', aabb: far },
      ],
      clips: [],
    });
    expect(result.displayRasterIds).toContain('near');
    expect(result.displayRasterIds).not.toContain('far');
    expect(result.pinRasterIds).toEqual(expect.arrayContaining(result.displayRasterIds));
    expect(new Set(result.pinRasterIds).size).toBe(result.pinRasterIds.length);
  });

  test('overscan includes a page just outside the raw viewport', () => {
    const cell = workspaceCellPad(4, 0);
    const view = workspaceSurfaceWorldAabb(200, 200, 0, 0, 1)!;
    const displayRect = inflateWorldAabb(view, cell.padX, cell.padY);
    const justOutside = pageInkWorldAabb({
      x: view.maxX + 8,
      y: 0,
      width: PAGE_DISPLAY_W,
    });
    expect(worldAabbsIntersect(view, justOutside)).toBe(false);
    expect(worldAabbsIntersect(displayRect, justOutside)).toBe(true);
    const result = cullWorkspaceInkRasters({
      surfaceWidth: 200,
      surfaceHeight: 200,
      panX: 0,
      panY: 0,
      zoom: 1,
      pairGap: 4,
      columnGap: 0,
      pages: [{ rasterId: 'neighbor', aabb: justOutside }],
      clips: [],
    });
    expect(result.displayRasterIds).toContain('neighbor');
  });

  test('always-display rasters stay mounted even when far away', () => {
    const far = pageInkWorldAabb({ x: 0, y: 8000, width: PAGE_DISPLAY_W });
    const result = cullWorkspaceInkRasters({
      surfaceWidth: 200,
      surfaceHeight: 200,
      panX: 0,
      panY: 0,
      zoom: 1,
      pages: [{ rasterId: 'far', aabb: far }],
      clips: [],
      alwaysDisplayRasterIds: ['far'],
    });
    expect(result.displayRasterIds).toContain('far');
    expect(result.pinRasterIds).toContain('far');
  });

  test('clips use their own AABB, not the page grid', () => {
    const result = cullWorkspaceInkRasters({
      surfaceWidth: 200,
      surfaceHeight: 200,
      panX: 0,
      panY: 0,
      zoom: 1,
      pages: [],
      clips: [
        {
          rasterId: 'clip-in',
          aabb: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
        },
        {
          rasterId: 'clip-out',
          aabb: { minX: 5000, minY: 5000, maxX: 5100, maxY: 5100 },
        },
      ],
    });
    expect(result.displayRasterIds).toContain('clip-in');
    expect(result.displayRasterIds).not.toContain('clip-out');
  });
});
