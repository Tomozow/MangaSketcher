import { layoutWorkspace, type VisualSlot } from './layout';
import type { PageId } from './types';

export const PAGE_DISPLAY_W = 108;
export const PAGE_DISPLAY_H = 152;
export const APPEND_W = 56;
export const STRIP_GAP = 8;
export const SPREAD_GAP = 16;
export const NUMBER_BAND = 32;

export type StripFrame = {
  key: string;
  slot: VisualSlot;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Reading-order insert index if a page is dropped on this frame. */
  insertIndex: number;
};

export function insertIndexForSlot(slot: VisualSlot, workspaceOrder: PageId[]): number {
  if (slot.kind === 'page') {
    return Math.max(0, workspaceOrder.indexOf(slot.pageId));
  }
  if (slot.kind === 'blank') {
    return 0;
  }
  return workspaceOrder.length;
}

export function buildStripFrames(workspaceOrder: PageId[]): {
  frames: StripFrame[];
  contentWidth: number;
  contentHeight: number;
} {
  const layout = layoutWorkspace(workspaceOrder);
  const frames: StripFrame[] = [];
  let x = 0;
  const y = 0;

  frames.push({
    key: 'append',
    slot: { kind: 'append' },
    x,
    y,
    width: APPEND_W,
    height: PAGE_DISPLAY_H,
    insertIndex: workspaceOrder.length,
  });
  x += APPEND_W + STRIP_GAP;

  layout.spreadsLtr.forEach((pair, spreadIndex) => {
    pair.forEach((slot, i) => {
      frames.push({
        key: `s${spreadIndex}-${i}-${slot.kind === 'page' ? slot.pageId : slot.kind}`,
        slot,
        x,
        y,
        width: PAGE_DISPLAY_W,
        height: PAGE_DISPLAY_H,
        insertIndex: insertIndexForSlot(slot, workspaceOrder),
      });
      x += PAGE_DISPLAY_W + (i === pair.length - 1 ? SPREAD_GAP : 4);
    });
  });

  return {
    frames,
    contentWidth: x + 24,
    contentHeight: PAGE_DISPLAY_H + NUMBER_BAND,
  };
}

export function hitStripFrame(frames: StripFrame[], worldX: number, worldY: number): StripFrame | null {
  let nearest: StripFrame | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    const dx = worldX - cx;
    const dy = worldY - cy;
    const inside =
      worldX >= frame.x &&
      worldX <= frame.x + frame.width &&
      worldY >= frame.y &&
      worldY <= frame.y + frame.height + NUMBER_BAND;
    const d = dx * dx + dy * dy;
    if (inside) {
      return frame;
    }
    if (d < best) {
      best = d;
      nearest = frame;
    }
  }
  return nearest;
}

export function pageLocalFromWorld(
  frame: StripFrame,
  worldX: number,
  worldY: number,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } {
  return {
    x: ((worldX - frame.x) / frame.width) * rasterWidth,
    y: ((worldY - frame.y) / frame.height) * rasterHeight,
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  panX: number,
  panY: number,
  zoom: number,
): { x: number; y: number } {
  return { x: (screenX - panX) / zoom, y: (screenY - panY) / zoom };
}
