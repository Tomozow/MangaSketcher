import type { Raster, Rgba, Rect } from './types';

export function createRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneRaster(raster: Raster): Raster {
  return {
    width: raster.width,
    height: raster.height,
    data: new Uint8ClampedArray(raster.data),
  };
}

export function rasterToArray(raster: Raster): number[] {
  return Array.from(raster.data);
}

export function rasterFromArray(width: number, height: number, data: number[]): Raster {
  return { width, height, data: Uint8ClampedArray.from(data) };
}

function indexAt(raster: Raster, x: number, y: number): number | null {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) {
    return null;
  }
  return (py * raster.width + px) * 4;
}

export function getPixel(raster: Raster, x: number, y: number): Rgba {
  const i = indexAt(raster, x, y);
  if (i === null) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: raster.data[i],
    g: raster.data[i + 1],
    b: raster.data[i + 2],
    a: raster.data[i + 3],
  };
}

export function setPixel(raster: Raster, x: number, y: number, color: Rgba): void {
  const i = indexAt(raster, x, y);
  if (i === null) {
    return;
  }
  raster.data[i] = color.r;
  raster.data[i + 1] = color.g;
  raster.data[i + 2] = color.b;
  raster.data[i + 3] = color.a;
}

export function parseHexColor(hex: string, opacity: number): Rgba {
  const raw = hex.replace('#', '');
  const n = raw.length === 3
    ? raw.split('').map((c) => c + c).join('')
    : raw;
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
    a: Math.round(Math.max(0, Math.min(1, opacity)) * 255),
  };
}

export function stampBrush(
  raster: Raster,
  cx: number,
  cy: number,
  radius: number,
  color: Rgba,
  erase: boolean,
): void {
  const r = Math.max(0.5, radius);
  const minX = Math.floor(cx - r);
  const maxX = Math.ceil(cx + r);
  const minY = Math.floor(cy - r);
  const maxY = Math.ceil(cy + r);
  const r2 = r * r;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) {
        continue;
      }
      if (erase) {
        const existing = getPixel(raster, x, y);
        const k = Math.max(0, Math.min(1, color.a / 255));
        if (k >= 0.999) {
          setPixel(raster, x, y, { r: 0, g: 0, b: 0, a: 0 });
        } else {
          setPixel(raster, x, y, {
            r: existing.r,
            g: existing.g,
            b: existing.b,
            a: Math.round(existing.a * (1 - k)),
          });
        }
      } else {
        const existing = getPixel(raster, x, y);
        const srcA = color.a / 255;
        const dstA = existing.a / 255;
        const outA = srcA + dstA * (1 - srcA);
        if (outA <= 0) {
          setPixel(raster, x, y, { r: 0, g: 0, b: 0, a: 0 });
        } else {
          setPixel(raster, x, y, {
            r: Math.round((color.r * srcA + existing.r * dstA * (1 - srcA)) / outA),
            g: Math.round((color.g * srcA + existing.g * dstA * (1 - srcA)) / outA),
            b: Math.round((color.b * srcA + existing.b * dstA * (1 - srcA)) / outA),
            a: Math.round(outA * 255),
          });
        }
      }
    }
  }
}

export function inkCells(raster: Raster): Array<{ x: number; y: number; color: string }> {
  const cells: Array<{ x: number; y: number; color: string }> = [];
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const p = getPixel(raster, x, y);
      if (p.a === 0) {
        continue;
      }
      cells.push({
        x,
        y,
        color: `rgba(${p.r},${p.g},${p.b},${p.a / 255})`,
      });
    }
  }
  return cells;
}

export function inkPixelCount(raster: Raster): number {
  let n = 0;
  for (let i = 3; i < raster.data.length; i += 4) {
    if (raster.data[i] > 0) {
      n += 1;
    }
  }
  return n;
}

export function cutRect(raster: Raster, rect: Rect): Raster {
  const cut = createRaster(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  for (let y = 0; y < cut.height; y += 1) {
    for (let x = 0; x < cut.width; x += 1) {
      const src = getPixel(raster, x0 + x, y0 + y);
      setPixel(cut, x, y, src);
      if (src.a > 0) {
        setPixel(raster, x0 + x, y0 + y, { r: 0, g: 0, b: 0, a: 0 });
      }
    }
  }
  return cut;
}

export function compositeRaster(
  dest: Raster,
  src: Raster,
  destX: number,
  destY: number,
  scale: number,
  rotation: number,
): void {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const cx = src.width / 2;
  const cy = src.height / 2;
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const pixel = getPixel(src, x, y);
      if (pixel.a === 0) {
        continue;
      }
      const lx = (x - cx) * scale;
      const ly = (y - cy) * scale;
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      const tx = destX + cx * scale + rx;
      const ty = destY + cy * scale + ry;
      const existing = getPixel(dest, tx, ty);
      const srcA = pixel.a / 255;
      const dstA = existing.a / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA <= 0) {
        continue;
      }
      setPixel(dest, tx, ty, {
        r: Math.round((pixel.r * srcA + existing.r * dstA * (1 - srcA)) / outA),
        g: Math.round((pixel.g * srcA + existing.g * dstA * (1 - srcA)) / outA),
        b: Math.round((pixel.b * srcA + existing.b * dstA * (1 - srcA)) / outA),
        a: Math.round(outA * 255),
      });
    }
  }
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
