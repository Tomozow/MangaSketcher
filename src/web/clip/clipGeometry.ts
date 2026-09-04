import {
  PAGE_DISPLAY_H,
  PAGE_DISPLAY_W,
  pageInkFrameAtWorld,
  pageLocalFromWorld,
  textChromeScreenMetrics,
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

export type WorldAabb = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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

/** Axis-aligned bounds of a rotated clip (matches getBoundingClientRect of the frame). */
export function clipWorldAxisAlignedBounds(bounds: ClipWorldBounds): WorldAabb {
  const cos = Math.abs(Math.cos(bounds.rotation));
  const sin = Math.abs(Math.sin(bounds.rotation));
  const extX = bounds.halfW * cos + bounds.halfH * sin;
  const extY = bounds.halfW * sin + bounds.halfH * cos;
  return {
    minX: bounds.cx - extX,
    minY: bounds.cy - extY,
    maxX: bounds.cx + extX,
    maxY: bounds.cy + extY,
  };
}

export function worldAabbFromRect(box: { x: number; y: number; width: number; height: number }): WorldAabb {
  return {
    minX: box.x,
    minY: box.y,
    maxX: box.x + box.width,
    maxY: box.y + box.height,
  };
}

/** Screen-space chrome origin relative to the workspace surface (outside CSS scale). */
export function chromeScreenPoseFromWorldAabbs(
  aabbs: readonly WorldAabb[],
  zoom: number,
  panX: number,
  panY: number,
): { left: number; top: number; button: number; gap: number } | null {
  if (aabbs.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  for (const box of aabbs) {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }
  const metrics = textChromeScreenMetrics();
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    left: minX * z + panX,
    top: minY * z + panY - metrics.stack,
    button: metrics.button,
    gap: metrics.gap,
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

function clipLocalToWorld(
  localX: number,
  localY: number,
  bounds: ClipWorldBounds,
): { x: number; y: number } {
  const cos = Math.cos(bounds.rotation);
  const sin = Math.sin(bounds.rotation);
  return {
    x: bounds.cx + localX * cos - localY * sin,
    y: bounds.cy + localX * sin + localY * cos,
  };
}

/** World point → clip raster pixels (origin top-left of the clip bitmap). */
export function worldPointToClipPixel(
  worldX: number,
  worldY: number,
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } {
  const bounds = clipWorldBounds(clip, size, rasterWidth, rasterHeight);
  const local = worldToClipLocal(worldX, worldY, bounds);
  const spanX = Math.max(1e-6, bounds.halfW * 2);
  const spanY = Math.max(1e-6, bounds.halfH * 2);
  return {
    x: ((local.x + bounds.halfW) / spanX) * size.width,
    y: ((local.y + bounds.halfH) / spanY) * size.height,
  };
}

export function worldPolygonToClipPixels(
  points: readonly { x: number; y: number }[],
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
): Array<{ x: number; y: number }> {
  return points.map((point) =>
    worldPointToClipPixel(point.x, point.y, clip, size, rasterWidth, rasterHeight),
  );
}

export function worldRectToClipPolygon(
  rect: Rect,
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
): Array<{ x: number; y: number }> {
  return worldPolygonToClipPixels(
    [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ],
    clip,
    size,
    rasterWidth,
    rasterHeight,
  );
}

/** Keep the remaining (or cut) ink in the same world pose after cropping the raster to `trim`. */
export function clipPoseAfterPixelTrim(
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
  trim: Rect,
): { x: number; y: number } {
  const bounds = clipWorldBounds(clip, size, rasterWidth, rasterHeight);
  const { sx, sy } = rasterToDisplayScale(rasterWidth, rasterHeight);
  const { scaleX, scaleY } = clipAxisScale(clip);
  const newHalfW = (trim.width * sx * scaleX) / 2;
  const newHalfH = (trim.height * sy * scaleY) / 2;
  const oldLocalX = trim.x * sx * scaleX - bounds.halfW;
  const oldLocalY = trim.y * sy * scaleY - bounds.halfH;
  const newCenter = clipLocalToWorld(oldLocalX + newHalfW, oldLocalY + newHalfH, bounds);
  return { x: newCenter.x - newHalfW, y: newCenter.y - newHalfH };
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
  zoom = 1,
): ClipHandle | null {
  const bounds = clipWorldBounds(clip, size, rasterWidth, rasterHeight);
  const local = worldToClipLocal(worldX, worldY, bounds);
  const handleR = CLIP_HANDLE_RADIUS / Math.max(0.1, zoom);

  if (selected) {
    const rotateX = 0;
    const rotateY = -bounds.halfH - handleR;
    if (dist(local.x, local.y, rotateX, rotateY) <= handleR) {
      return 'rotate';
    }
    const cornerX = bounds.halfW;
    const cornerY = bounds.halfH;
    if (dist(local.x, local.y, cornerX, cornerY) <= handleR) {
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

export type PolyPoint = { x: number; y: number };

/** Axis-aligned bounds of a polygon. Null when fewer than 3 points. */
export function polygonAabb(points: readonly PolyPoint[]): Rect | null {
  if (points.length < 3) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pointInPolygon(x: number, y: number, points: readonly PolyPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!;
    const b = points[j]!;
    const intersect = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(a: PolyPoint, b: PolyPoint, c: PolyPoint, d: PolyPoint): boolean {
  const cross = (p: PolyPoint, q: PolyPoint, r: PolyPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  const ab = (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0);
  const cd = (d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0);
  return ab && cd;
}

function closedEdges(points: readonly PolyPoint[]): Array<[PolyPoint, PolyPoint]> {
  if (points.length < 2) {
    return [];
  }
  const edges: Array<[PolyPoint, PolyPoint]> = [];
  for (let i = 0; i < points.length; i += 1) {
    edges.push([points[i]!, points[(i + 1) % points.length]!]);
  }
  return edges;
}

/** True when an axis-aligned rect shares any area with the polygon. */
export function rectTouchesPolygon(rect: Rect, points: readonly PolyPoint[]): boolean {
  if (points.length < 3 || !(rect.width > 0) || !(rect.height > 0)) {
    return false;
  }
  const corners: PolyPoint[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  for (const corner of corners) {
    if (pointInPolygon(corner.x, corner.y, points)) {
      return true;
    }
  }
  for (const point of points) {
    if (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    ) {
      return true;
    }
  }
  for (const [a, b] of closedEdges(corners)) {
    for (const [c, d] of closedEdges(points)) {
      if (segmentsIntersect(a, b, c, d)) {
        return true;
      }
    }
  }
  return false;
}

/** True when the clip OBB shares any area with the polygon. */
export function clipTouchesPolygon(
  clip: ClipMetaLike,
  size: ClipRasterSize,
  rasterWidth: number,
  rasterHeight: number,
  points: readonly PolyPoint[],
): boolean {
  if (points.length < 3) {
    return false;
  }
  const bounds = clipWorldBounds(clip, size, rasterWidth, rasterHeight);
  const corners = clipWorldCorners(bounds);
  for (const corner of corners) {
    if (pointInPolygon(corner.x, corner.y, points)) {
      return true;
    }
  }
  for (const point of points) {
    const local = worldToClipLocal(point.x, point.y, bounds);
    if (Math.abs(local.x) <= bounds.halfW && Math.abs(local.y) <= bounds.halfH) {
      return true;
    }
  }
  for (const [a, b] of closedEdges(corners)) {
    for (const [c, d] of closedEdges(points)) {
      if (segmentsIntersect(a, b, c, d)) {
        return true;
      }
    }
  }
  return false;
}

export function worldPointsToPageLocal(
  frame: { x: number; y: number; width: number; height: number },
  points: readonly PolyPoint[],
  rasterWidth: number,
  rasterHeight: number,
): PolyPoint[] {
  return points.map((point) => ({
    x: ((point.x - frame.x) / frame.width) * rasterWidth,
    y: ((point.y - frame.y) / frame.height) * rasterHeight,
  }));
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
