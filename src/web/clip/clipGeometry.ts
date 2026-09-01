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
  scaleY?: number;
  rotation: number;
};

export function clipAxisScale(clip: { scale: number; scaleY?: number }): { scaleX: number; scaleY: number } {
  const scaleX = Number.isFinite(clip.scale) && clip.scale > 0 ? clip.scale : 1;
  const scaleY = Number.isFinite(clip.scaleY) && (clip.scaleY as number) > 0 ? (clip.scaleY as number) : scaleX;
  return { scaleX, scaleY };
}

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
  const { scaleX, scaleY } = clipAxisScale(clip);
  const halfW = (size.width * sx * scaleX) / 2;
  const halfH = (size.height * sy * scaleY) / 2;
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

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right - x <= 0 || bottom - y <= 0) {
    return null;
  }
  return { x, y, width: right - x, height: bottom - y };
}

export function worldRectToPageLocalRect(
  frame: { x: number; y: number; width: number; height: number },
  worldRect: Rect,
  rasterWidth: number,
  rasterHeight: number,
): Rect | null {
  const hit = intersectRects(worldRect, {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  });
  if (!hit) {
    return null;
  }
  return {
    x: ((hit.x - frame.x) / frame.width) * rasterWidth,
    y: ((hit.y - frame.y) / frame.height) * rasterHeight,
    width: (hit.width / frame.width) * rasterWidth,
    height: (hit.height / frame.height) * rasterHeight,
  };
}

export function pageLocalRectToWorldRect(
  frameX: number,
  frameY: number,
  frameW: number,
  frameH: number,
  rect: Rect,
  rasterWidth: number,
  rasterHeight: number,
): Rect {
  return {
    x: frameX + (rect.x / rasterWidth) * frameW,
    y: frameY + (rect.y / rasterHeight) * frameH,
    width: (rect.width / rasterWidth) * frameW,
    height: (rect.height / rasterHeight) * frameH,
  };
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

/** SE-handle free scale: opposite (NW) corner stays, axes are independent. */
export function freeScaleFromCornerDrag(input: {
  startX: number;
  startY: number;
  startScaleX: number;
  startScaleY: number;
  startHalfW: number;
  startHalfH: number;
  rotation: number;
  worldX: number;
  worldY: number;
}): { x: number; y: number; scale: number; scaleY: number } {
  const startCx = input.startX + input.startHalfW;
  const startCy = input.startY + input.startHalfH;
  const cos = Math.cos(input.rotation);
  const sin = Math.sin(input.rotation);
  const nwX = startCx + -input.startHalfW * cos - -input.startHalfH * sin;
  const nwY = startCy + -input.startHalfW * sin + -input.startHalfH * cos;
  const local = worldToClipLocal(input.worldX, input.worldY, {
    cx: nwX,
    cy: nwY,
    halfW: 0,
    halfH: 0,
    rotation: input.rotation,
  });
  const baseHalfW = input.startHalfW / input.startScaleX;
  const baseHalfH = input.startHalfH / input.startScaleY;
  const minHalfW = baseHalfW * MIN_CLIP_SCALE;
  const minHalfH = baseHalfH * MIN_CLIP_SCALE;
  const newHalfW = Math.max(minHalfW, local.x / 2);
  const newHalfH = Math.max(minHalfH, local.y / 2);
  const newCx = nwX + newHalfW * cos - newHalfH * sin;
  const newCy = nwY + newHalfW * sin + newHalfH * cos;
  return {
    x: newCx - newHalfW,
    y: newCy - newHalfH,
    scale: newHalfW / baseHalfW,
    scaleY: newHalfH / baseHalfH,
  };
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

export function clipWorldAabb(
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
): Rect {
  const corners = clipWorldCorners(clipWorldBounds(clip, size, rasterWidth, rasterHeight));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
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
