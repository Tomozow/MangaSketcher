import { buildStripFrames, hitStripFrame, screenToWorld, type StripLayoutOptions } from '../../domain/stripGeometry';
import type { PageId } from '../../domain/types';
import { THUMB_HEIGHT, THUMB_WIDTH } from '../ink/InkEngine';

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
): { x: number; y: number } {
  if (layout === 'grid') {
    return { x: 0, y: 0 };
  }
  const localX = clientX - surfaceRect.left;
  const localY = clientY - surfaceRect.top;
  const { x, y } = screenToWorld(localX, localY, panX, panY, zoom);
  return { x: x - THUMB_WIDTH / 2, y: y - THUMB_HEIGHT / 2 };
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