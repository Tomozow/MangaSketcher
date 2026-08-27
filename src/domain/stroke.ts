import { stampBrush } from './raster';
import type { Raster, Rgba } from './types';

export type StrokePoint = { x: number; y: number; pressure: number };

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
      const t = s / steps;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      });
    }
  }
  return out;
}

export function stampStroke(
  raster: Raster,
  points: StrokePoint[],
  radiusFor: (pressure: number) => number,
  color: Rgba,
  erase: boolean,
): void {
  const sample = points[0] ? radiusFor(points[0].pressure) : 1;
  const dense = densifyStroke(points, Math.max(0.4, sample * 0.35));
  for (const p of dense) {
    stampBrush(raster, p.x, p.y, radiusFor(p.pressure), color, erase);
  }
}
