import { stampBrush } from './raster';
import type { Raster, Rgba } from './types';

export type StrokePoint = { x: number; y: number; pressure: number };

/**
 * Streamline + densify, after steveruizok/perfect-freehand getStrokePoints
 * (lerp toward the latest sample, skip duplicates, fill gaps for stamp spacing).
 */
export function streamlineStroke(points: StrokePoint[], streamline = 0.45): StrokePoint[] {
  if (points.length === 0) {
    return [];
  }
  const t = 0.15 + (1 - streamline) * 0.7;
  const pts = points.map((p) => ({ ...p }));
  if (pts.length === 2) {
    const a = pts[0];
    const b = pts[1];
    const filled: StrokePoint[] = [a];
    for (let i = 1; i < 5; i += 1) {
      const k = i / 4;
      filled.push({
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        pressure: a.pressure + (b.pressure - a.pressure) * k,
      });
    }
    pts.splice(0, pts.length, ...filled);
  }
  const out: StrokePoint[] = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i += 1) {
    const prev = out[out.length - 1];
    const curr = pts[i];
    const x = prev.x + (curr.x - prev.x) * t;
    const y = prev.y + (curr.y - prev.y) * t;
    if (x === prev.x && y === prev.y) {
      continue;
    }
    out.push({
      x,
      y,
      pressure: curr.pressure,
    });
  }
  if (out.length === 1) {
    out.push({ x: pts[0].x + 0.01, y: pts[0].y, pressure: pts[0].pressure });
  }
  return out;
}

export function densifyStroke(points: StrokePoint[], spacing: number): StrokePoint[] {
  if (points.length === 0) {
    return [];
  }
  const out: StrokePoint[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(0.35, spacing)));
    for (let s = 1; s <= steps; s += 1) {
      const k = s / steps;
      out.push({
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        pressure: a.pressure + (b.pressure - a.pressure) * k,
      });
    }
  }
  return out;
}

export function prepareStroke(points: StrokePoint[], spacing: number): StrokePoint[] {
  return densifyStroke(streamlineStroke(points), spacing);
}

export function stampStroke(
  raster: Raster,
  points: StrokePoint[],
  radiusFor: (pressure: number) => number,
  color: Rgba,
  erase: boolean,
): void {
  const sample = points[0] ? radiusFor(points[0].pressure) : 1;
  const dense = prepareStroke(points, Math.max(0.4, sample * 0.35));
  for (const p of dense) {
    stampBrush(raster, p.x, p.y, radiusFor(p.pressure), color, erase);
  }
}
