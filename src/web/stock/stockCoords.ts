import { buildStripFrames, hitStripFrame, screenToWorld, type StripLayoutOptions } from '../../domain/stripGeometry';
import type { PageId } from '../../domain/types';
import { THUMB_HEIGHT, THUMB_WIDTH } from '../ink/InkEngine';

export const STOCK_FREE_THUMB_WIDTH = THUMB_WIDTH / 2;
export const STOCK_FREE_THUMB_HEIGHT = THUMB_HEIGHT / 2;
export const STOCK_FREE_PAGE_WIDTH = THUMB_WIDTH;
export const STOCK_FREE_PAGE_HEIGHT = THUMB_HEIGHT;

export function pointInRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

export function clientToStockWorld(
  clientX: number,
  clientY: number,
  surfaceRect: DOMRect,
  panX: number,
  panY: number,
  zoom: number,
  layout: 'free' | 'grid',
  thumbSize?: { width: number; height: number },
  grabOffset?: { x: number; y: number },
): { x: number; y: number } {
  if (layout === 'grid') {
    return { x: 0, y: 0 };
  }
  const localX = clientX - surfaceRect.left;
  const localY = clientY - surfaceRect.top;
  const { x, y } = screenToWorld(localX, localY, panX, panY, zoom);
  if (grabOffset) {
    return { x: x - grabOffset.x, y: y - grabOffset.y };
  }
  const halfW = (thumbSize?.width ?? STOCK_FREE_THUMB_WIDTH) / 2;
  const halfH = (thumbSize?.height ?? STOCK_FREE_THUMB_HEIGHT) / 2;
  return { x: x - halfW, y: y - halfH };
}

export function resolveWorkspaceInsertIndex(
  clientX: number,
  clientY: number,
  workspaceRect: DOMRect,
  workspaceOrder: PageId[],
  panX: number,
  panY: number,
  zoom: number,
  stripLayout?: StripLayoutOptions,
): number | null {
  if (!pointInRect(clientX, clientY, workspaceRect)) {
    return null;
  }
  const localX = clientX - workspaceRect.left;
  const localY = clientY - workspaceRect.top;
  const { x: worldX, y: worldY } = screenToWorld(localX, localY, panX, panY, zoom);
  const { frames } = buildStripFrames(workspaceOrder, stripLayout);
  const frame = hitStripFrame(frames, worldX, worldY);
  return frame?.insertIndex ?? workspaceOrder.length;
}

export function clientOverStockPane(clientX: number, clientY: number): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const el = document.elementFromPoint(clientX, clientY);
  return Boolean(el?.closest('[data-ms-region="stock"]'));
}

export function clientToWorkspaceWorld(
  clientX: number,
  clientY: number,
  workspaceRect: DOMRect,
  panX: number,
  panY: number,
  zoom: number,
): { x: number; y: number } | null {
  if (!pointInRect(clientX, clientY, workspaceRect)) {
    return null;
  }
  const localX = clientX - workspaceRect.left;
  const localY = clientY - workspaceRect.top;
  return screenToWorld(localX, localY, panX, panY, zoom);
}