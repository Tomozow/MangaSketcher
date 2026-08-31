import { describe, expect, test } from 'vitest';

import {
  clampWorkspaceZoom,
  neighborWorkspacePageId,
  panViewToWorldRect,
  WORKSPACE_MAX_ZOOM,
  WORKSPACE_MIN_ZOOM,
  zoomViewAroundPivot,
} from '../workspaceView';

describe('workspaceView', () => {
  test('zoom を最小・最大に収める', () => {
    expect(clampWorkspaceZoom(0)).toBe(WORKSPACE_MIN_ZOOM);
    expect(clampWorkspaceZoom(99)).toBe(WORKSPACE_MAX_ZOOM);
    expect(clampWorkspaceZoom(Number.NaN)).toBe(1);
    expect(clampWorkspaceZoom(1.5)).toBe(1.5);
  });

  test('ピボットを中心に拡大縮小する', () => {
    const next = zoomViewAroundPivot({ zoom: 1, panX: 10, panY: 20 }, 2, 100, 80);
    expect(next.zoom).toBe(2);
    expect(next.panX).toBe(100 - (100 - 10) * 2);
    expect(next.panY).toBe(80 - (80 - 20) * 2);
  });

  test('上限ではズームもパンも変えない', () => {
    const view = { zoom: WORKSPACE_MAX_ZOOM, panX: 4, panY: 8 };
    expect(zoomViewAroundPivot(view, 1.25, 40, 40)).toEqual(view);
  });

  test('ページ枠の中心がビューポート中央に来るようパンする', () => {
    const next = panViewToWorldRect(
      { zoom: 2, panX: 0, panY: 0 },
      { x: 100, y: 50, width: 200, height: 100 },
      { width: 800, height: 600 },
    );
    expect(next.zoom).toBe(2);
    expect(next.panX).toBe(400 - 200 * 2);
    expect(next.panY).toBe(300 - 100 * 2);
  });

  test('隣のページは読み順で選ぶ', () => {
    const order = ['a', 'b', 'c'];
    expect(neighborWorkspacePageId(order, 'b', -1)).toBe('a');
    expect(neighborWorkspacePageId(order, 'b', 1)).toBe('c');
    expect(neighborWorkspacePageId(order, 'a', -1)).toBeNull();
    expect(neighborWorkspacePageId(order, 'c', 1)).toBeNull();
    expect(neighborWorkspacePageId(order, null, 1)).toBe('a');
    expect(neighborWorkspacePageId(order, null, -1)).toBeNull();
    expect(neighborWorkspacePageId([], 'a', 1)).toBeNull();
  });

  test('見開き送りはページ1の次が2、2/3の次が4', () => {
    const order = ['p1', 'p2', 'p3', 'p4', 'p5'];
    expect(neighborWorkspacePageId(order, 'p1', 1, 'spread')).toBe('p2');
    expect(neighborWorkspacePageId(order, 'p2', 1, 'spread')).toBe('p4');
    expect(neighborWorkspacePageId(order, 'p3', 1, 'spread')).toBe('p4');
    expect(neighborWorkspacePageId(order, 'p2', -1, 'spread')).toBe('p1');
    expect(neighborWorkspacePageId(order, 'p3', -1, 'spread')).toBe('p1');
    expect(neighborWorkspacePageId(order, 'p4', -1, 'spread')).toBe('p2');
    expect(neighborWorkspacePageId(order, 'p5', 1, 'spread')).toBeNull();
  });
});
