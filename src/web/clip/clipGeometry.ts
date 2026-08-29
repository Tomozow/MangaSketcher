import {
  PAGE_DISPLAY_H,
  PAGE_DISPLAY_W,
  pageInkFrameAtWorld,
  pageLocalFromWorld,
  type StripFrame,
} from '../../domain/stripGeometry';
import type { ClipId, PageId, Rect } from '../../domain/types';
import { CLIP_HANDLE_RADIUS, MIN_CLIP_SCALE } from './constants';

export type ClipMetaLike = {
  id: ClipId;
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type ClipRasterSize = { width: number; height: number };

export type ClipHandle = 'body' | 'corner' | 'rotate';

export type ClipWorldBounds = {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  rotation: number;
};

export function rasterToDisplayScale(rasterWidth: number, rasterHeight: number): { sx: number; sy: number } {
  return { sx: PAGE_DISPLAY_W / rasterWidth, sy: PAGE_DISPLAY_H / rasterHeight };
}

export function clipWorldBounds(
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
): ClipWorldBounds {
  const { sx, sy } = rasterToDisplayScale(rasterWidth, rasterHeight);
  const halfW = (size.width * sx * clip.scale) / 2;
  const halfH = (size.height * sy * clip.scale) / 2;
  return {
    cx: clip.x + halfW,
    cy: clip.y + halfH,
    halfW,
    halfH,
    rotation: clip.rotation,
  };
}

/** Origin and center must sit on the same page ink rect before a clip can bake into a コマ. */
export function clipInsertTarget(
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
  frames: StripFrame[],
): { pageId: PageId; localX: number; localY: number } | null {
  const bounds = clipWorldBounds(clip, size, rasterWidth, rasterHeight);
  const originFrame = pageInkFrameAtWorld(frames, clip.x, clip.y);
  const centerFrame = pageInkFrameAtWorld(frames, bounds.cx, bounds.cy);
  if (
    !originFrame ||
    !centerFrame ||
    originFrame.slot.kind !== 'page' ||
    centerFrame.slot.kind !== 'page' ||
    originFrame.slot.pageId !== centerFrame.slot.pageId
  ) {
    return null;
  }
  const local = pageLocalFromWorld(centerFrame, bounds.cx, bounds.cy, rasterWidth, rasterHeight);
  return { pageId: originFrame.slot.pageId, localX: local.x, localY: local.y };
}

function worldToClipLocal(
  worldX: number,
  worldY: number,
  bounds: ClipWorldBounds,
): { x: number; y: number } {
  const dx = worldX - bounds.cx;
  const dy = worldY - bounds.cy;
  const cos = Math.cos(-bounds.rotation);
  const sin = Math.sin(-bounds.rotation);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function hitClipAt(
  worldX: number,
  worldY: number,
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
  selected: boolean,
): ClipHandle | null {
  const bounds = clipWorldBounds(clip, size, rasterWidth, rasterHeight);
  const local = worldToClipLocal(worldX, worldY, bounds);

  if (selected) {
    const rotateX = 0;
    const rotateY = -bounds.halfH - CLIP_HANDLE_RADIUS;
    if (dist(local.x, local.y, rotateX, rotateY) <= CLIP_HANDLE_RADIUS) {
      return 'rotate';
    }
    const cornerX = bounds.halfW;
    const cornerY = bounds.halfH;
    if (dist(local.x, local.y, cornerX, cornerY) <= CLIP_HANDLE_RADIUS) {
      return 'corner';
    }
  }

  if (Math.abs(local.x) <= bounds.halfW && Math.abs(local.y) <= bounds.halfH) {
    return 'body';
  }
  return null;
}

export function pageLocalRectToWorld(
  frameX: number,
  frameY: number,
  frameW: number,
  frameH: number,
  rect: Rect,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } {
  return {
    x: frameX + (rect.x / rasterWidth) * frameW,
    y: frameY + (rect.y / rasterHeight) * frameH,
  };
}

export function normalizeMarqueeRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

export function scaleFromCornerDrag(
  startScale: number,
  startDist: number,
  currentDist: number,
): number {
  if (startDist <= 0) {
    return startScale;
  }
  return Math.max(MIN_CLIP_SCALE, startScale * (currentDist / startDist));
}

export function rotationFromHandleDrag(
  startRotation: number,
  startAngle: number,
  currentAngle: number,
): number {
  return startRotation + (currentAngle - startAngle);
}

export function clipWorldCorners(bounds: ClipWorldBounds): Array<{ x: number; y: number }> {
  const cos = Math.cos(bounds.rotation);
  const sin = Math.sin(bounds.rotation);
  return [
    { x: -bounds.halfW, y: -bounds.halfH },
    { x: bounds.halfW, y: -bounds.halfH },
    { x: bounds.halfW, y: bounds.halfH },
    { x: -bounds.halfW, y: bounds.halfH },
  ].map((local) => ({
    x: bounds.cx + local.x * cos - local.y * sin,
    y: bounds.cy + local.x * sin + local.y * cos,
  }));
}

function projectAxis(
  points: Array<{ x: number; y: number }>,
  ax: number,
  ay: number,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const d = point.x * ax + point.y * ay;
    if (d < min) {
      min = d;
    }
    if (d > max) {
      max = d;
    }
  }
  return { min, max };
}

function rangesOverlap(a: { min: number; max: number }, b: { min: number; max: number }): boolean {
  return a.max >= b.min && b.max >= a.min;
}

/** True when the clip OBB shares any area or edge with an axis-aligned world rect. */
export function clipTouchesWorldRect(
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
  rect: Rect,
): boolean {
  if (!(rect.width > 0) || !(rect.height > 0)) {
    return false;
  }
  const bounds = clipWorldBounds(clip, size, rasterWidth, rasterHeight);
  const corners = clipWorldCorners(bounds);
  const rectCorners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: Math.cos(bounds.rotation), y: Math.sin(bounds.rotation) },
    { x: -Math.sin(bounds.rotation), y: Math.cos(bounds.rotation) },
  ];
  for (const axis of axes) {
    if (!rangesOverlap(projectAxis(corners, axis.x, axis.y), projectAxis(rectCorners, axis.x, axis.y))) {
      return false;
    }
  }
  return true;
}

export function selectedClipIdsOf(doc: {
  selectedClipId: ClipId | null;
  selectedClipIds?: readonly ClipId[] | null;
}): ClipId[] {
  if (Array.isArray(doc.selectedClipIds)) {
    return [...doc.selectedClipIds];
  }
  return doc.selectedClipId ? [doc.selectedClipId] : [];
}

export function angleFromCenter(cx: number, cy: number, x: number, y: number): number {
  return Math.atan2(y - cy, x - cx);
}
