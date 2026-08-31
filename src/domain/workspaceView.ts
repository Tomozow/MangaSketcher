import { readingSpreads, type SpreadPair } from './layout';

export const WORKSPACE_MIN_ZOOM = 0.25;
export const WORKSPACE_MAX_ZOOM = 4;
export const WORKSPACE_ZOOM_STEP = 1.25;

export type WorkspaceView = {
  zoom: number;
  panX: number;
  panY: number;
};

export function clampWorkspaceZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(WORKSPACE_MAX_ZOOM, Math.max(WORKSPACE_MIN_ZOOM, zoom));
}

export function zoomViewAroundPivot(
  view: WorkspaceView,
  factor: number,
  pivotX: number,
  pivotY: number,
): WorkspaceView {
  const zoom = clampWorkspaceZoom(view.zoom * factor);
  if (zoom === view.zoom) {
    return view;
  }
  const ratio = zoom / Math.max(0.01, view.zoom);
  return {
    zoom,
    panX: pivotX - (pivotX - view.panX) * ratio,
    panY: pivotY - (pivotY - view.panY) * ratio,
  };
}

export function panViewToWorldRect(
  view: WorkspaceView,
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): WorkspaceView {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return {
    zoom: view.zoom,
    panX: viewport.width / 2 - cx * view.zoom,
    panY: viewport.height / 2 - cy * view.zoom,
  };
}

export type WorkspacePageTurnUnit = 'page' | 'spread';

export function neighborWorkspacePageId(
  workspaceOrder: readonly string[],
  selectedPageId: string | null,
  delta: -1 | 1,
  unit: WorkspacePageTurnUnit = 'page',
): string | null {
  if (unit === 'spread') {
    return neighborWorkspaceSpreadPageId(workspaceOrder, selectedPageId, delta);
  }
  if (workspaceOrder.length === 0) {
    return null;
  }
  if (selectedPageId == null) {
    return delta > 0 ? workspaceOrder[0]! : null;
  }
  const index = workspaceOrder.indexOf(selectedPageId);
  if (index < 0) {
    return delta > 0 ? workspaceOrder[0]! : workspaceOrder[workspaceOrder.length - 1]!;
  }
  const next = index + delta;
  if (next < 0 || next >= workspaceOrder.length) {
    return null;
  }
  return workspaceOrder[next]!;
}

function firstReadingPageIdOfSpread(pair: SpreadPair): string | null {
  const pages = pair.filter((slot): slot is Extract<SpreadPair[number], { kind: 'page' }> => slot.kind === 'page');
  if (pages.length === 0) {
    return null;
  }
  pages.sort((a, b) => a.number - b.number);
  return pages[0]!.pageId;
}

function neighborWorkspaceSpreadPageId(
  workspaceOrder: readonly string[],
  selectedPageId: string | null,
  delta: -1 | 1,
): string | null {
  if (workspaceOrder.length === 0) {
    return null;
  }
  const spreads = readingSpreads([...workspaceOrder]);
  const firstIds = spreads
    .map(firstReadingPageIdOfSpread)
    .filter((pageId): pageId is string => pageId != null);
  if (firstIds.length === 0) {
    return null;
  }
  if (selectedPageId == null) {
    return delta > 0 ? firstIds[0]! : null;
  }
  const currentSpread = spreads.findIndex((pair) =>
    pair.some((slot) => slot.kind === 'page' && slot.pageId === selectedPageId),
  );
  const index = currentSpread < 0 ? (delta > 0 ? -1 : 0) : currentSpread;
  const next = index + delta;
  if (next < 0 || next >= firstIds.length) {
    return null;
  }
  return firstIds[next]!;
}
