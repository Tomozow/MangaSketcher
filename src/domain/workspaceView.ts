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

export function neighborWorkspacePageId(
  workspaceOrder: readonly string[],
  selectedPageId: string | null,
  delta: -1 | 1,
): string | null {
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
