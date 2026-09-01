/**
 * Minimal OffscreenCanvas stand-in for Vitest (Node has no OffscreenCanvas).
 * Supports source-over / destination-out compositing needed by §9.2–9.3 tests.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(input: string): Rgba {
  const hex = input.trim();
  if (hex.startsWith('#') && hex.length === 7) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: 255,
    };
  }
  return { r: 0, g: 0, b: 0, a: 255 };
}

function blendSourceOver(
  dst: Rgba,
  src: Rgba,
  alpha: number,
): Rgba {
  const sa = (src.a / 255) * alpha;
  const da = dst.a / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const r = (src.r * sa + dst.r * da * (1 - sa)) / outA;
  const g = (src.g * sa + dst.g * da * (1 - sa)) / outA;
  const b = (src.b * sa + dst.b * da * (1 - sa)) / outA;
  return { r, g, b, a: Math.round(outA * 255) };
}

function blendDestinationOut(dst: Rgba, src: Rgba, alpha: number): Rgba {
  const sa = (src.a / 255) * alpha;
  const outA = (dst.a / 255) * (1 - sa);
  return { r: dst.r, g: dst.g, b: dst.b, a: Math.round(outA * 255) };
}

function blendDestinationIn(dst: Rgba, src: Rgba, alpha: number): Rgba {
  const sa = (src.a / 255) * alpha;
  const outA = (dst.a / 255) * sa;
  return { r: dst.r, g: dst.g, b: dst.b, a: Math.round(outA * 255) };
}

function pointInPolygon(x: number, y: number, path: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i, i += 1) {
    const a = path[i]!;
    const b = path[j]!;
    const intersect = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

export class FakeCanvas2DContext {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';

  private readonly canvas: FakeOffscreenCanvas;
  private path: { x: number; y: number }[] = [];
  private pathStarted = false;
  private stack: {
    fillStyle: string;
    strokeStyle: string;
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
    lineWidth: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
  }[] = [];
  private offsetX = 0;
  private offsetY = 0;
  private scaleX = 1;
  private scaleY = 1;

  constructor(canvas: FakeOffscreenCanvas) {
    this.canvas = canvas;
  }

  save(): void {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
    });
  }

  restore(): void {
    const prev = this.stack.pop();
    if (!prev) {
      return;
    }
    this.fillStyle = prev.fillStyle;
    this.strokeStyle = prev.strokeStyle;
    this.globalAlpha = prev.globalAlpha;
    this.globalCompositeOperation = prev.globalCompositeOperation;
    this.lineWidth = prev.lineWidth;
    this.lineCap = prev.lineCap;
    this.lineJoin = prev.lineJoin;
    this.offsetX = prev.offsetX;
    this.offsetY = prev.offsetY;
    this.scaleX = prev.scaleX;
    this.scaleY = prev.scaleY;
  }

  translate(x: number, y: number): void {
    this.offsetX += x;
    this.offsetY += y;
  }

  rotate(_angle: number): void {
    // Rotation is not simulated in the fake canvas; bake tests use rotation=0.
  }

  scale(x: number, y?: number): void {
    this.scaleX *= x;
    this.scaleY *= y ?? x;
  }

  beginPath(): void {
    this.path = [];
    this.pathStarted = false;
  }

  moveTo(x: number, y: number): void {
    this.path = [{ x, y }];
    this.pathStarted = true;
  }

  lineTo(x: number, y: number): void {
    if (!this.pathStarted) {
      this.moveTo(x, y);
      return;
    }
    this.path.push({ x, y });
  }

  closePath(): void {
    const first = this.path[0];
    const last = this.path[this.path.length - 1];
    if (!first || !last) {
      return;
    }
    if (first.x !== last.x || first.y !== last.y) {
      this.path.push({ x: first.x, y: first.y });
    }
  }

  arc(x: number, y: number, radius: number, _start: number, _end: number): void {
    this.paintDisk(x, y, radius, parseColor(this.fillStyle));
  }

  fill(): void {
    if (this.path.length < 3) {
      return;
    }
    const color = parseColor(this.fillStyle);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of this.path) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    const x0 = Math.floor(minX);
    const y0 = Math.floor(minY);
    const x1 = Math.ceil(maxX);
    const y1 = Math.ceil(maxY);
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        if (pointInPolygon(px + 0.5, py + 0.5, this.path)) {
          this.paintPixel(px, py, color);
        }
      }
    }
  }

  stroke(): void {
    if (this.path.length < 2) {
      return;
    }
    const color = parseColor(this.strokeStyle);
    const radius = this.lineWidth / 2;
    for (let i = 0; i < this.path.length - 1; i += 1) {
      const a = this.path[i]!;
      const b = this.path[i + 1]!;
      this.paintSegment(a.x, a.y, b.x, b.y, radius, color);
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const color = parseColor(this.fillStyle);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.ceil(x + w);
    const y1 = Math.ceil(y + h);
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        this.paintPixel(px, py, color);
      }
    }
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const prev = this.globalCompositeOperation;
    this.globalCompositeOperation = 'destination-out';
    this.fillStyle = '#000000';
    this.globalAlpha = 1;
    this.fillRect(x, y, w, h);
    this.globalCompositeOperation = prev;
  }

  drawImage(
    source: FakeOffscreenCanvas,
    sxOrDx: number,
    syOrDy: number,
    swOrDw?: number,
    shOrDh?: number,
    dx?: number,
    dy?: number,
    dw?: number,
    dh?: number,
  ): void {
    if (dx !== undefined && dy !== undefined && dw !== undefined && dh !== undefined) {
      const sx = sxOrDx;
      const sy = syOrDy;
      const sw = swOrDw!;
      const sh = shOrDh!;
      const srcCtx = source.getContext('2d');
      if (!srcCtx) {
        return;
      }
      const srcData = srcCtx.getImageData(0, 0, source.width, source.height).data;
      for (let y = 0; y < dh; y += 1) {
        for (let x = 0; x < dw; x += 1) {
          const srcX = Math.min(source.width - 1, sx + Math.floor((x / dw) * sw));
          const srcY = Math.min(source.height - 1, sy + Math.floor((y / dh) * sh));
          const i = (srcY * source.width + srcX) * 4;
          const src: Rgba = {
            r: srcData[i]!,
            g: srcData[i + 1]!,
            b: srcData[i + 2]!,
            a: srcData[i + 3]!,
          };
          if (src.a > 0 || this.globalCompositeOperation === 'destination-in') {
            const px = this.offsetX + (dx + x) * this.scaleX;
            const py = this.offsetY + (dy + y) * this.scaleY;
            this.paintPixel(Math.floor(px), Math.floor(py), src);
          }
        }
      }
      return;
    }

    const destX = this.offsetX + sxOrDx * this.scaleX;
    const destY = this.offsetY + syOrDy * this.scaleY;
    const sw = swOrDw ?? source.width;
    const sh = shOrDh ?? source.height;
    const srcCtx = source.getContext('2d');
    if (!srcCtx) {
      return;
    }
    const srcData = srcCtx.getImageData(0, 0, source.width, source.height).data;
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const sx = Math.min(source.width - 1, Math.floor((x / sw) * source.width));
        const sy = Math.min(source.height - 1, Math.floor((y / sh) * source.height));
        const i = (sy * source.width + sx) * 4;
        const src: Rgba = {
          r: srcData[i]!,
          g: srcData[i + 1]!,
          b: srcData[i + 2]!,
          a: srcData[i + 3]!,
        };
        if (src.a > 0 || this.globalCompositeOperation === 'destination-in') {
          this.paintPixel(Math.floor(destX + x), Math.floor(destY + y), src);
        }
      }
    }
  }

  getImageData(x: number, y: number, w: number, h: number): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py += 1) {
      for (let px = 0; px < w; px += 1) {
        const src = this.canvas.readPixel(x + px, y + py);
        const i = (py * w + px) * 4;
        data[i] = src.r;
        data[i + 1] = src.g;
        data[i + 2] = src.b;
        data[i + 3] = src.a;
      }
    }
    return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
  }

  putImageData(image: ImageData, dx: number, dy: number): void {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const i = (y * image.width + x) * 4;
        const color: Rgba = {
          r: image.data[i]!,
          g: image.data[i + 1]!,
          b: image.data[i + 2]!,
          a: image.data[i + 3]!,
        };
        this.canvas.writePixel(dx + x, dy + y, color);
      }
    }
  }

  private paintSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
    color: Rgba,
  ): void {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.paintDisk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, color);
    }
  }

  private paintDisk(cx: number, cy: number, radius: number, color: Rgba): void {
    const r = Math.ceil(radius);
    const x0 = Math.floor(cx - r);
    const y0 = Math.floor(cy - r);
    const x1 = Math.ceil(cx + r);
    const y1 = Math.ceil(cy + r);
    const r2 = radius * radius;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) {
          this.paintPixel(x, y, color);
        }
      }
    }
  }

  private paintPixel(x: number, y: number, src: Rgba): void {
    const dst = this.canvas.readPixel(x, y);
    const next =
      this.globalCompositeOperation === 'destination-out'
        ? blendDestinationOut(dst, src, this.globalAlpha)
        : this.globalCompositeOperation === 'destination-in'
          ? blendDestinationIn(dst, src, this.globalAlpha)
          : blendSourceOver(dst, src, this.globalAlpha);
    this.canvas.writePixel(x, y, next);
  }
}

export class FakeOffscreenCanvas {
  width: number;
  height: number;

  private readonly ctx: FakeCanvas2DContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = new FakeCanvas2DContext(this);
    this.ctx.clearRect(0, 0, width, height);
  }

  private readonly pixels = new Map<number, Rgba>();

  readPixel(x: number, y: number): Rgba {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    return this.pixels.get(y * this.width + x) ?? { r: 0, g: 0, b: 0, a: 0 };
  }

  writePixel(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    const key = y * this.width + x;
    if (color.a === 0) {
      this.pixels.delete(key);
      return;
    }
    this.pixels.set(key, color);
  }

  getContext(type: '2d'): FakeCanvas2DContext | null {
    return type === '2d' ? this.ctx : null;
  }

  async convertToBlob(): Promise<Blob> {
    const raw = this.getContext('2d')!.getImageData(0, 0, this.width, this.height);
    const header = new ArrayBuffer(8);
    new DataView(header).setUint32(0, this.width);
    new DataView(header).setUint32(4, this.height);
    const bytes = new Uint8Array(8 + raw.data.length);
    bytes.set(new Uint8Array(header), 0);
    bytes.set(raw.data, 8);
    return new Blob([bytes], { type: 'application/x-ink-fake-png' });
  }
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** True when buffer starts with the standard PNG file signature. */
export function isPngBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) {
    return false;
  }
  const bytes = new Uint8Array(buffer, 0, 8);
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** Width/height from a real PNG IHDR or an ink snapshot header. */
export function encodedRasterDimensions(
  buffer: ArrayBuffer,
): { width: number; height: number } | null {
  const snapshot = tryDecodeInkSnapshot(buffer);
  if (snapshot) {
    return { width: snapshot.width, height: snapshot.height };
  }
  if (!isPngBuffer(buffer) || buffer.byteLength < 24) {
    return null;
  }
  const view = new DataView(buffer);
  if (view.getUint32(12) !== 0x49484452) {
    return null;
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 32767 || height > 32767) {
    return null;
  }
  return { width, height };
}

/**
 * Undo snapshots and Vitest fake canvases use raw RGBA + 8-byte width/height header.
 * Returns null for real PNGs and malformed buffers.
 */
export function tryDecodeInkSnapshot(
  buffer: ArrayBuffer,
): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (buffer.byteLength < 8 || isPngBuffer(buffer)) {
    return null;
  }
  const view = new DataView(buffer);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  if (width <= 0 || height <= 0 || width > 32767 || height > 32767) {
    return null;
  }
  const pixelBytes = width * height * 4;
  if (!Number.isSafeInteger(pixelBytes) || buffer.byteLength !== 8 + pixelBytes) {
    return null;
  }
  return {
    width,
    height,
    data: new Uint8ClampedArray(buffer, 8, pixelBytes),
  };
}

export function decodeFakePng(buffer: ArrayBuffer): { width: number; height: number; data: Uint8ClampedArray } {
  const decoded = tryDecodeInkSnapshot(buffer);
  if (!decoded) {
    throw new Error('invalid ink snapshot buffer');
  }
  return decoded;
}

export function countAlphaPixels(
  ctx: { getImageData(x: number, y: number, w: number, h: number): ImageData },
  w: number,
  h: number,
): number {
  const image = ctx.getImageData(0, 0, w, h);
  let count = 0;
  for (let i = 3; i < image.data.length; i += 4) {
    if (image.data[i]! > 0) {
      count += 1;
    }
  }
  return count;
}

/** Vitest stand-in for ImageBitmap produced by thumb generation. */
export class FakeImageBitmap {
  readonly width: number;
  readonly height: number;
  private _closed = false;

  constructor(readonly canvas: FakeOffscreenCanvas) {
    this.width = canvas.width;
    this.height = canvas.height;
  }

  close(): void {
    this._closed = true;
  }

  isClosed(): boolean {
    return this._closed;
  }
}

export async function fakeCreateImageBitmap(
  source: FakeOffscreenCanvas,
): Promise<FakeImageBitmap> {
  const copy = new FakeOffscreenCanvas(source.width, source.height);
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0);
  }
  return new FakeImageBitmap(copy);
}
