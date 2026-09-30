import {
  canvasBakeClipOntoPage,
  canvasClearLassoPolygon,
  canvasCopyLassoRegion,
  canvasCopyPageRect,
  cropCanvasToRect,
  inkAlphaBounds,
} from '../clip/clipCanvas';
import { intersectRects, polygonAabb } from '../clip/clipGeometry';
import { encodedRasterDimensions, isPngBuffer, tryDecodeInkSnapshot } from './fakeCanvas';
import { tryDecodePngToRgba } from '@/src/storage/compactInkPng';
import { isInkUndoPatch, type InkUndoPixels } from '@/src/storage/types';
import { inkLog } from './inkDebugLog';

/** §9.7 standard drag thumbnail size. */
export const THUMB_WIDTH = 144;
export const THUMB_HEIGHT = 204;
/** §9.7 compact sidebar thumbnail size (UI scales; engine emits standard). */
export const COMPACT_THUMB_WIDTH = 112;
export const COMPACT_THUMB_HEIGHT = 158;

type Ink2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type InkCanvas = OffscreenCanvas;

export type CanvasFactory = (width: number, height: number) => InkCanvas;

export type EncodePng = (canvas: InkCanvas) => Promise<ArrayBuffer>;

export type CreateThumbBitmap = (canvas: InkCanvas) => Promise<ImageBitmap>;

export type DrawTemplate = (ctx: Ink2DContext, width: number, height: number) => void;

export type InkEngineCallbacks = {
  onEncodingStarted?: (rasterId: string) => void;
  onEncodingComplete?: (rasterId: string, buffer: ArrayBuffer) => void;
  /** Encode gave up (retries exhausted). PNG for this raster is stale until a later encode succeeds. */
  onEncodingFailed?: (rasterId: string) => void;
  /** Encode no longer applies (raster disposed / restored); do not wait for completion. */
  onEncodingAborted?: (rasterId: string) => void;
  onBake?: (rasterId: string) => void;
  /** Encoded pixels landed on the hot canvas (sync snapshot or async PNG). */
  onHotPixelsReady?: (rasterId: string) => void;
  /** A reduced-size preview of a cold raster is ready to paint. */
  onPreviewReady?: (rasterId: string) => void;
  /**
   * These rasters were created, consumed or restored by an edit that goes with a document change
   * (cut, bake, merge, undo). The document must not be saved before their PNGs are.
   */
  onDocumentNeeds?: (rasterIds: string[]) => void;
};

export type InkAutosaveSink = {
  notifyEncodingStarted(rasterId: string): void;
  notifyEncodingComplete(rasterId: string, buffer: ArrayBuffer): void;
  notifyEncodingFailed?(rasterId: string): void;
  notifyEncodingAborted?(rasterId: string): void;
  notifyDocumentNeeds?(rasterIds: string[]): void;
  scheduleDocumentSave(dirtyRasterIds: string[]): void;
};

/** Full-size canvases kept for rasters that are not pinned. */
const HOT_CANVAS_LIMIT = 8;
const PREVIEW_LIMIT = 96;
/** iPad Safari fails encodes (and drops canvas backing) when many full-size convertToBlob run at once. */
const MAX_CONCURRENT_ENCODES = 2;
const ENCODE_MAX_ATTEMPTS = 3;
const ENCODE_RETRY_BASE_MS = 500;

async function defaultEncodePng(canvas: InkCanvas): Promise<ArrayBuffer> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

function defaultCanvasFactory(width: number, height: number): InkCanvas {
  return new OffscreenCanvas(width, height);
}

async function defaultCreateThumbBitmap(canvas: InkCanvas): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'undefined') {
    throw new Error('createImageBitmap unavailable');
  }
  return createImageBitmap(canvas);
}

function isClipRasterId(rasterId: string): boolean {
  return rasterId.includes(':clip:');
}

export function fitClipThumbSize(srcW: number, srcH: number): { width: number; height: number } {
  const w = Math.max(1, srcW);
  const h = Math.max(1, srcH);
  const scale = Math.min(THUMB_WIDTH / w, THUMB_HEIGHT / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function drawInkOntoThumbCanvas(
  ctx: Ink2DContext,
  source: CanvasImageSource & { width: number; height: number },
  destWidth: number,
  destHeight: number,
): void {
  const srcW = source.width;
  const srcH = source.height;
  if (srcW <= 0 || srcH <= 0 || destWidth <= 0 || destHeight <= 0) {
    return;
  }
  ctx.drawImage(source, 0, 0, destWidth, destHeight);
}

export class InkEngine {
  readonly hot = new Map<string, InkCanvas>();
  readonly encodedPng = new Map<string, ArrayBuffer>();
  readonly thumbs = new Map<string, ImageBitmap>();

  private readonly rasterWidth: number;
  private readonly rasterHeight: number;
  private readonly canvasFactory: CanvasFactory;
  private readonly encodePng: EncodePng;
  private readonly createThumbBitmap: CreateThumbBitmap;
  private readonly drawTemplate?: DrawTemplate;
  private callbacks: InkEngineCallbacks = {};

  private readonly lru: string[] = [];
  private readonly overlays = new Map<string, InkCanvas>();
  private readonly overlayCtx = new Map<string, Ink2DContext>();
  private readonly strokeUndoCanvas = new Map<string, InkCanvas>();
  private readonly pendingUndo: { rasterId: string; canvas: InkUndoPixels }[] = [];
  /** Centre-line bounds of the stroke in progress, so its undo keeps only the touched rect. */
  private readonly strokeBounds = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number; lineWidth: number }
  >();
  /** Display-size bitmaps for rasters shown without a full-size hot canvas. */
  private readonly previews = new Map<string, { bitmap: ImageBitmap; generation: number; width: number }>();
  private readonly previewLoading = new Set<string>();
  private readonly pendingEncodeIds = new Set<string>();
  private readonly pendingEncodes = new Set<string>();
  private readonly thumbGeneration = new Map<string, number>();
  private readonly blitEpoch = new Map<string, number>();
  /** Bumped whenever encodedPng content changes; stale async blits must not apply. */
  private readonly encodedGeneration = new Map<string, number>();
  /** Hot was recreated while encode was in flight; refresh when encode completes. */
  private readonly deferredHotRefresh = new Set<string>();
  /** Bumped when hot canvas pixels are baked/erased/restored; stale async blits must not apply. */
  private readonly hotRevision = new Map<string, number>();
  /** Bumped on each startEncode; stale encode completions must not apply. */
  private readonly encodeGeneration = new Map<string, number>();
  /** Visible strip rasters kept decoded (§9.6); never LRU-evicted. */
  private readonly pinnedHotRasterIds = new Set<string>();
  private readonly rasterDimensions = new Map<string, { width: number; height: number }>();
  /** Async PNG blits still landing on a recreated hot canvas (canvas is blank until then). */
  private readonly blitPending = new Map<string, Promise<void>>();
  private activeEncodes = 0;
  private readonly encodeWaiters: Array<() => void> = [];
  private readonly thumbReadyListeners = new Set<(rasterId: string) => void>();

  constructor(options: {
    rasterWidth: number;
    rasterHeight: number;
    emptyPng: ArrayBuffer;
    canvasFactory?: CanvasFactory;
    encodePng?: EncodePng;
    createThumbBitmap?: CreateThumbBitmap;
    drawTemplate?: DrawTemplate;
    callbacks?: InkEngineCallbacks;
  }) {
    this.rasterWidth = options.rasterWidth;
    this.rasterHeight = options.rasterHeight;
    this.canvasFactory = options.canvasFactory ?? defaultCanvasFactory;
    this.encodePng = options.encodePng ?? defaultEncodePng;
    this.createThumbBitmap = options.createThumbBitmap ?? defaultCreateThumbBitmap;
    this.drawTemplate = options.drawTemplate;
    if (options.callbacks) {
      this.callbacks = options.callbacks;
    }
    void options.emptyPng;
  }

  setCallbacks(callbacks: InkEngineCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /** Keep workspace-visible rasters decoded; they are excluded from LRU eviction. */
  setPinnedHotRasterIds(rasterIds: readonly string[]): void {
    this.pinnedHotRasterIds.clear();
    for (const rasterId of rasterIds) {
      this.pinnedHotRasterIds.add(rasterId);
    }
  }

  registerRaster(rasterId: string, png?: ArrayBuffer): void {
    const hadEncoded = this.encodedPng.has(rasterId);
    const prevLen = this.encodedPng.get(rasterId)?.byteLength ?? 0;
    const pngLen = png?.byteLength ?? 0;
    if (!hadEncoded) {
      this.noteEncodedPng(rasterId, png ?? new ArrayBuffer(0));
    } else if (pngLen > 0 && prevLen === 0) {
      this.noteEncodedPng(rasterId, png);
    }
    if (!this.rasterDimensions.has(rasterId)) {
      if (rasterId.includes(':page:')) {
        this.rasterDimensions.set(rasterId, { width: this.rasterWidth, height: this.rasterHeight });
      } else {
        const stored = this.encodedPng.get(rasterId);
        const parsed =
          stored && stored.byteLength > 0 ? encodedRasterDimensions(stored) : null;
        this.rasterDimensions.set(
          rasterId,
          parsed ?? { width: this.rasterWidth, height: this.rasterHeight },
        );
      }
    }
    const stored = this.encodedPng.get(rasterId);
    const storedLen = stored?.byteLength ?? 0;
    const canvas = this.hot.get(rasterId);
    if (canvas && stored && storedLen > 0 && storedLen !== prevLen) {
      this.blitEncodedPng(canvas, stored, rasterId, this.bumpBlitEpoch(rasterId));
    }
  }

  /** Copy hot pixels of a clip/page raster into a new raster id (same dimensions). */
  duplicateRaster(sourceRasterId: string, destRasterId: string): boolean {
    if (sourceRasterId === destRasterId) {
      return false;
    }
    const dims = this.getRasterDimensions(sourceRasterId);
    this.registerClipRaster(destRasterId, dims.width, dims.height);
    const dest = this.decode(destRasterId);
    const source = this.decodeForEdit(sourceRasterId);
    const ctx = dest.getContext('2d');
    if (!ctx) {
      this.disposeRaster(destRasterId);
      return false;
    }
    ctx.clearRect(0, 0, dest.width, dest.height);
    ctx.drawImage(source as unknown as CanvasImageSource, 0, 0);
    this.bumpHotRevision(destRasterId);
    this.invalidateThumb(destRasterId);
    this.callbacks.onDocumentNeeds?.([destRasterId]);
    this.startEncode(destRasterId);
    void this.generateThumb(destRasterId);
    this.callbacks.onBake?.(destRasterId);
    return true;
  }

  registerClipRaster(rasterId: string, width: number, height: number, png?: ArrayBuffer): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.rasterDimensions.set(rasterId, { width: w, height: h });
    if (!this.encodedPng.has(rasterId)) {
      this.noteEncodedPng(rasterId, png ?? new ArrayBuffer(0));
    }
  }

  getRasterDimensions(rasterId: string): { width: number; height: number } {
    return (
      this.rasterDimensions.get(rasterId) ?? { width: this.rasterWidth, height: this.rasterHeight }
    );
  }

  disposeRaster(rasterId: string): void {
    inkLog('InkEngine.disposeRaster', 'dispose', { rasterId, pendingEncode: this.pendingEncodes.has(rasterId) });
    if (this.pendingEncodes.delete(rasterId)) {
      this.callbacks.onEncodingAborted?.(rasterId);
    }
    this.hot.delete(rasterId);
    this.overlays.delete(rasterId);
    this.overlayCtx.delete(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
    this.strokeBounds.delete(rasterId);
    this.previews.get(rasterId)?.bitmap.close();
    this.previews.delete(rasterId);
    this.encodedPng.delete(rasterId);
    this.rasterDimensions.delete(rasterId);
    this.blitEpoch.delete(rasterId);
    this.encodedGeneration.delete(rasterId);
    this.deferredHotRefresh.delete(rasterId);
    this.hotRevision.delete(rasterId);
    this.encodeGeneration.delete(rasterId);
    this.thumbGeneration.delete(rasterId);
    const thumb = this.thumbs.get(rasterId);
    if (thumb) {
      thumb.close();
      this.thumbs.delete(rasterId);
    }
    const idx = this.lru.indexOf(rasterId);
    if (idx >= 0) {
      this.lru.splice(idx, 1);
    }
  }

  /**
   * True while the raster's ink is not yet on its hot canvas: evicted, or recreated with the PNG
   * still decoding. Edits that consume or overwrite the canvas must wait, or they act on blank pixels.
   */
  needsDecode(rasterId: string): boolean {
    if ((this.encodedPng.get(rasterId)?.byteLength ?? 0) === 0) {
      return false;
    }
    return !this.hot.has(rasterId) || this.blitPending.has(rasterId);
  }

  async ensureDecoded(rasterIds: readonly string[]): Promise<void> {
    for (const rasterId of rasterIds) {
      this.decode(rasterId);
    }
    await Promise.all(rasterIds.map((rasterId) => this.blitPending.get(rasterId)));
  }

  getHotContext(rasterId: string): Ink2DContext | null {
    return this.decode(rasterId).getContext('2d');
  }

  decode(rasterId: string): InkCanvas {
    let canvas = this.hot.get(rasterId);
    const dims = this.getRasterDimensions(rasterId);
    if (!canvas) {
      canvas = this.canvasFactory(dims.width, dims.height);
      const png = this.encodedPng.get(rasterId);
      const epoch = this.bumpBlitEpoch(rasterId);
      const ctx = canvas.getContext('2d');
      inkLog('InkEngine.decode', 'hot recreated', {
        rasterId,
        pngBytes: png?.byteLength ?? 0,
        pendingEncode: this.pendingEncodes.has(rasterId),
        pendingEncodeId: this.pendingEncodeIds.has(rasterId),
        hotCount: this.hot.size,
      });
      if (this.pendingEncodes.has(rasterId)) {
        // Encode in flight may carry fresher pixels than encodedPng; refresh on complete.
        ctx?.clearRect(0, 0, dims.width, dims.height);
        this.deferredHotRefresh.add(rasterId);
      } else if (png && png.byteLength > 0) {
        this.blitEncodedPng(canvas, png, rasterId, epoch);
      } else {
        ctx?.clearRect(0, 0, dims.width, dims.height);
      }
      this.hot.set(rasterId, canvas);
    }
    this.touchLru(rasterId);
    return canvas;
  }

  /**
   * decode() for callers about to read or change the pixels. A PNG still landing asynchronously
   * would be dropped by the edit's revision bump (the ink is lost), so decode it right here.
   */
  private decodeForEdit(rasterId: string): InkCanvas {
    const canvas = this.decode(rasterId);
    if (!this.blitPending.has(rasterId)) {
      return canvas;
    }
    const png = this.encodedPng.get(rasterId);
    const decoded = png ? tryDecodePngToRgba(png) : null;
    const ctx = canvas.getContext('2d');
    if (!decoded || !ctx || decoded.width !== canvas.width || decoded.height !== canvas.height) {
      inkLog('InkEngine.decodeForEdit', 'sync decode unavailable; edit may race the async decode', { rasterId });
      return canvas;
    }
    const pixels = new Uint8ClampedArray(
      decoded.rgba.buffer as ArrayBuffer,
      decoded.rgba.byteOffset,
      decoded.rgba.byteLength,
    );
    ctx.putImageData(
      typeof ImageData !== 'undefined'
        ? new ImageData(pixels, decoded.width, decoded.height)
        : ({ data: pixels, width: decoded.width, height: decoded.height } as ImageData),
      0,
      0,
    );
    this.bumpBlitEpoch(rasterId);
    this.blitPending.delete(rasterId);
    return canvas;
  }

  private touchLru(rasterId: string): void {
    const idx = this.lru.indexOf(rasterId);
    if (idx >= 0) {
      this.lru.splice(idx, 1);
    }
    this.lru.push(rasterId);
    let unpinned = this.lru.filter((id) => !this.pinnedHotRasterIds.has(id)).length;
    while (unpinned > HOT_CANVAS_LIMIT) {
      // Never the raster being touched: its caller is about to use the canvas.
      const evictIdx = this.lru.findIndex(
        (id) =>
          id !== rasterId &&
          !this.pinnedHotRasterIds.has(id) &&
          !this.overlays.has(id) &&
          !this.strokeUndoCanvas.has(id) &&
          !this.pendingEncodes.has(id) &&
          !this.pendingEncodeIds.has(id) &&
          (this.encodedPng.get(id)?.byteLength ?? 0) > 0,
      );
      if (evictIdx < 0) {
        break;
      }
      const evictId = this.lru.splice(evictIdx, 1)[0];
      if (evictId) {
        inkLog('InkEngine.touchLru', 'evict hot', { rasterId: evictId, pngBytes: this.encodedPng.get(evictId)?.byteLength ?? 0 });
        this.hot.delete(evictId);
      }
      unpinned -= 1;
    }
  }

  private bumpBlitEpoch(rasterId: string): number {
    const next = (this.blitEpoch.get(rasterId) ?? 0) + 1;
    this.blitEpoch.set(rasterId, next);
    return next;
  }

  private noteEncodedPng(rasterId: string, png: ArrayBuffer): void {
    this.encodedPng.set(rasterId, png.slice(0));
    this.encodedGeneration.set(rasterId, (this.encodedGeneration.get(rasterId) ?? 0) + 1);
  }

  private bumpHotRevision(rasterId: string): void {
    this.hotRevision.set(rasterId, (this.hotRevision.get(rasterId) ?? 0) + 1);
  }

  private blitEncodedPng(canvas: InkCanvas, png: ArrayBuffer, rasterId: string, epoch: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const snapshot = tryDecodeInkSnapshot(png);
    if (snapshot) {
      try {
        this.ensureCanvasSize(rasterId, canvas, snapshot.width, snapshot.height);
        const imageData =
          typeof ImageData !== 'undefined'
            ? new ImageData(snapshot.data, snapshot.width, snapshot.height)
            : ({ data: snapshot.data, width: snapshot.width, height: snapshot.height } as ImageData);
        ctx.putImageData(imageData, 0, 0);
        this.callbacks.onHotPixelsReady?.(rasterId);
        return;
      } catch {
        const dims = this.getRasterDimensions(rasterId);
        ctx.clearRect(0, 0, dims.width, dims.height);
        return;
      }
    }
    if (!isPngBuffer(png)) {
      const dims = this.getRasterDimensions(rasterId);
      ctx.clearRect(0, 0, dims.width, dims.height);
      return;
    }
    const pending = this.blitEncodedPngAsync(
      canvas,
      png,
      rasterId,
      epoch,
      this.encodedGeneration.get(rasterId) ?? 0,
      this.hotRevision.get(rasterId) ?? 0,
    );
    this.blitPending.set(rasterId, pending);
    void pending.finally(() => {
      if (this.blitPending.get(rasterId) === pending) {
        this.blitPending.delete(rasterId);
      }
    });
  }

  private ensureCanvasSize(rasterId: string, canvas: InkCanvas, width: number, height: number): void {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      this.rasterDimensions.set(rasterId, { width, height });
    }
  }

  private async blitEncodedPngAsync(
    canvas: InkCanvas,
    png: ArrayBuffer,
    rasterId: string,
    epoch: number,
    encodedGeneration: number,
    hotRevision: number,
  ): Promise<void> {
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof createImageBitmap === 'undefined') {
      return;
    }
    const blob = new Blob([png.slice(0)], { type: 'image/png' });
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      return;
    }
    const epochNow = this.blitEpoch.get(rasterId);
    const generationNow = this.encodedGeneration.get(rasterId) ?? 0;
    const revisionNow = this.hotRevision.get(rasterId) ?? 0;
    const hotCanvas = this.hot.get(rasterId);
    if (
      epochNow !== epoch ||
      generationNow !== encodedGeneration ||
      revisionNow !== hotRevision ||
      hotCanvas !== canvas ||
      this.overlays.has(rasterId)
    ) {
      bitmap.close();
      return;
    }
    const dims = this.getRasterDimensions(rasterId);
    this.ensureCanvasSize(rasterId, canvas, dims.width, dims.height);
    ctx.clearRect(0, 0, dims.width, dims.height);
    ctx.drawImage(bitmap, 0, 0, dims.width, dims.height);
    bitmap.close();
    this.callbacks.onHotPixelsReady?.(rasterId);
  }

  beginPenOverlay(rasterId: string): Ink2DContext {
    this.captureStrokeUndo(rasterId);
    const dims = this.getRasterDimensions(rasterId);
    let overlay = this.overlays.get(rasterId);
    if (!overlay) {
      overlay = this.canvasFactory(dims.width, dims.height);
      this.overlays.set(rasterId, overlay);
    }
    let ctx = this.overlayCtx.get(rasterId);
    if (!ctx) {
      const created = overlay.getContext('2d');
      if (!created) {
        throw new Error('pen overlay 2d context unavailable');
      }
      ctx = created;
      this.overlayCtx.set(rasterId, ctx);
    }
    ctx.clearRect(0, 0, dims.width, dims.height);
    return ctx;
  }

  getPenOverlayContext(rasterId: string): Ink2DContext | null {
    return this.overlayCtx.get(rasterId) ?? this.overlays.get(rasterId)?.getContext('2d') ?? null;
  }

  hasPenOverlay(rasterId: string): boolean {
    return this.overlays.has(rasterId);
  }

  /** §9.5 display copy: hot page + live pen overlay at CSS size. */
  paintDisplay(ctx: Ink2DContext, rasterId: string, width: number, height: number): void {
    if (
      !this.hot.has(rasterId) &&
      !this.pinnedHotRasterIds.has(rasterId) &&
      typeof createImageBitmap !== 'undefined'
    ) {
      // Cold raster (e.g. one of many pages in an overview): do not spend a full-size canvas on it.
      const png = this.encodedPng.get(rasterId);
      if (!png || png.byteLength === 0) {
        ctx.clearRect(0, 0, width, height);
        return;
      }
      if (isPngBuffer(png)) {
        this.paintPreview(ctx, rasterId, png, width, height);
        return;
      }
    }
    const page = this.decode(rasterId);
    if (this.blitPending.has(rasterId) && !this.overlays.has(rasterId)) {
      // Hot canvas is blank until its PNG lands (then onHotPixelsReady repaints); do not flash empty.
      const cached = this.previews.get(rasterId);
      if (cached?.generation === (this.encodedGeneration.get(rasterId) ?? 0)) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(cached.bitmap, 0, 0, width, height);
      }
      return;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(page as unknown as CanvasImageSource, 0, 0, width, height);
    const overlay = this.overlays.get(rasterId);
    if (overlay) {
      ctx.drawImage(overlay as unknown as CanvasImageSource, 0, 0, width, height);
    }
  }

  private paintPreview(ctx: Ink2DContext, rasterId: string, png: ArrayBuffer, width: number, height: number): void {
    const generation = this.encodedGeneration.get(rasterId) ?? 0;
    const cached = this.previews.get(rasterId);
    if (cached?.generation === generation) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(cached.bitmap, 0, 0, width, height);
      if (cached.width >= width) {
        return;
      }
    }
    // No current preview: keep whatever the display already shows until one is ready.
    if (this.previewLoading.has(rasterId)) {
      return;
    }
    this.previewLoading.add(rasterId);
    const blob = new Blob([png], { type: 'image/png' });
    void createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
      .catch(() => createImageBitmap(blob))
      .then((bitmap) => {
        this.previewLoading.delete(rasterId);
        if (!this.encodedPng.has(rasterId) || (this.encodedGeneration.get(rasterId) ?? 0) !== generation) {
          bitmap.close();
        } else {
          this.previews.get(rasterId)?.bitmap.close();
          this.previews.delete(rasterId);
          this.previews.set(rasterId, { bitmap, generation, width });
          for (const [oldId, old] of this.previews) {
            if (this.previews.size <= PREVIEW_LIMIT) {
              break;
            }
            old.bitmap.close();
            this.previews.delete(oldId);
          }
        }
        this.callbacks.onPreviewReady?.(rasterId);
      })
      .catch(() => {
        this.previewLoading.delete(rasterId);
      });
  }

  /**
   * Record where the stroke in progress draws (raster pixels). Its undo then keeps only that rect.
   * Every pixel the stroke changes must be covered; points are centres, `lineWidth` the widest line.
   */
  noteStrokePoints(rasterId: string, points: ReadonlyArray<{ x: number; y: number }>, lineWidth: number): void {
    const bounds = this.strokeBounds.get(rasterId) ?? {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      lineWidth: 0,
    };
    for (const point of points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    bounds.lineWidth = Math.max(bounds.lineWidth, lineWidth);
    this.strokeBounds.set(rasterId, bounds);
  }

  /** Full snapshot → patch of the noted stroke rect. Falls back to the full snapshot when unsure. */
  private cropStrokeUndo(rasterId: string, snapshot: InkCanvas): InkUndoPixels {
    const bounds = this.strokeBounds.get(rasterId);
    this.strokeBounds.delete(rasterId);
    if (!bounds) {
      return snapshot;
    }
    const pad = bounds.lineWidth / 2 + 2;
    const x = Math.max(0, Math.floor(bounds.minX - pad));
    const y = Math.max(0, Math.floor(bounds.minY - pad));
    const right = Math.min(snapshot.width, Math.ceil(bounds.maxX + pad));
    const bottom = Math.min(snapshot.height, Math.ceil(bounds.maxY + pad));
    if (!(right > x && bottom > y)) {
      return snapshot;
    }
    const canvas = cropCanvasToRect(snapshot, { x, y, width: right - x, height: bottom - y }, (w, h) =>
      this.canvasFactory(w, h),
    );
    snapshot.width = 0;
    snapshot.height = 0;
    return { canvas, x, y };
  }

  /**
   * Overlay → page blit only. Heavy undo encode is deferred via drainPendingBakeWork.
   */
  blitPenOverlay(rasterId: string): void {
    const overlay = this.overlays.get(rasterId);
    const page = this.decodeForEdit(rasterId);
    const pageCtx = page.getContext('2d');
    if (!overlay || !pageCtx) {
      return;
    }
    this.bumpBlitEpoch(rasterId);
    this.stashUndoSnapshot(rasterId);
    pageCtx.drawImage(overlay as unknown as CanvasImageSource, 0, 0);
    this.bumpHotRevision(rasterId);
    this.overlayCtx.get(rasterId)?.clearRect(0, 0, this.rasterWidth, this.rasterHeight);
    this.overlays.delete(rasterId);
    this.overlayCtx.delete(rasterId);
    this.invalidateThumb(rasterId);
    this.pendingEncodeIds.add(rasterId);
  }

  hasPendingUndoSnapshots(): boolean {
    return this.pendingUndo.length > 0;
  }

  hasPendingBakeWork(): boolean {
    return this.pendingUndo.length > 0 || this.pendingEncodeIds.size > 0;
  }

  drainPendingBakeWork(
    maxUndo = Number.POSITIVE_INFINITY,
    options?: { encode?: boolean },
  ): { rasterId: string; canvas: InkUndoPixels }[] {
    const drained: { rasterId: string; canvas: InkUndoPixels }[] = [];
    let n = 0;
    while (this.pendingUndo.length > 0 && n < maxUndo) {
      const item = this.pendingUndo.shift();
      if (!item) {
        break;
      }
      drained.push({ rasterId: item.rasterId, canvas: item.canvas });
      n += 1;
    }
    if (options?.encode !== false && this.pendingUndo.length === 0) {
      this.flushPendingEncodes();
    }
    return drained;
  }

  flushPendingEncodes(): void {
    if (this.pendingEncodeIds.size > 0) {
      inkLog('InkEngine.flushPendingEncodes', 'flush', {
        ids: [...this.pendingEncodeIds],
        hot: [...this.pendingEncodeIds].map((id) => this.hot.has(id)),
      });
    }
    for (const rasterId of this.pendingEncodeIds) {
      void this.generateThumb(rasterId);
      this.startEncode(rasterId);
      this.callbacks.onBake?.(rasterId);
    }
    this.pendingEncodeIds.clear();
  }

  /**
   * §9.2: overlay → page 1:1 bake, clear overlay, start PNG encode, return undo PNG.
   */
  bakePenOverlay(rasterId: string): ArrayBuffer {
    this.blitPenOverlay(rasterId);
    const drained = this.drainPendingBakeWork();
    const found = drained.find((item) => item.rasterId === rasterId);
    if (!found || found.canvas instanceof ArrayBuffer || isInkUndoPatch(found.canvas)) {
      return new ArrayBuffer(0);
    }
    return this.canvasToUndoBuffer(found.canvas);
  }

  cancelPenOverlay(rasterId: string): void {
    this.overlays.delete(rasterId);
    this.overlayCtx.delete(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
    this.strokeBounds.delete(rasterId);
  }

  /**
   * §9.3: erase directly on page/clip hot canvas. Overlay destination-out is forbidden.
   */
  beginEraseDirect(rasterId: string): Ink2DContext {
    this.captureStrokeUndo(rasterId);
    const ctx = this.decodeForEdit(rasterId).getContext('2d');
    if (!ctx) {
      throw new Error(`beginEraseDirect: 2d context unavailable for ${rasterId}`);
    }
    return ctx;
  }

  finishEraseDirect(rasterId: string): InkUndoPixels {
    const undo = this.takeStrokeUndoSnapshot(rasterId);
    this.bumpHotRevision(rasterId);
    this.invalidateThumb(rasterId);
    void this.generateThumb(rasterId);
    this.startEncode(rasterId);
    this.callbacks.onBake?.(rasterId);
    return undo;
  }

  /** Clear all ink on a page/clip raster and return the pre-clear undo snapshot. */
  clearRaster(rasterId: string): InkUndoPixels {
    this.cancelPenOverlay(rasterId);
    const ctx = this.beginEraseDirect(rasterId);
    const dims = this.getRasterDimensions(rasterId);
    ctx.clearRect(0, 0, dims.width, dims.height);
    return this.finishEraseDirect(rasterId);
  }

  cancelEraseDirect(rasterId: string): void {
    const undo = this.strokeUndoCanvas.get(rasterId);
    const page = this.hot.get(rasterId);
    if (undo && page) {
      const ctx = page.getContext('2d');
      ctx?.clearRect(0, 0, this.rasterWidth, this.rasterHeight);
      ctx?.drawImage(undo as unknown as CanvasImageSource, 0, 0);
    }
    this.strokeUndoCanvas.delete(rasterId);
  }

  restoreRasterFromUndo(rasterId: string, undo: InkUndoPixels): void {
    inkLog('InkEngine.restoreRasterFromUndo', 'restore', {
      rasterId,
      kind: undo instanceof ArrayBuffer ? 'buffer' : isInkUndoPatch(undo) ? 'patch' : 'canvas',
    });
    if (undo instanceof ArrayBuffer) {
      this.restoreRasterFromPng(rasterId, undo);
      return;
    }
    if (isInkUndoPatch(undo)) {
      const canvas = this.decodeForEdit(rasterId);
      if (this.blitPending.has(rasterId)) {
        // The rest of the raster is not on the canvas yet; a patch drawn now would replace it.
        void this.ensureDecoded([rasterId]).then(() => this.restoreRasterFromUndo(rasterId, undo));
        return;
      }
      this.cancelPendingEncode(rasterId);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(undo.x, undo.y, undo.canvas.width, undo.canvas.height);
        ctx.drawImage(undo.canvas, undo.x, undo.y);
      }
      this.bumpHotRevision(rasterId);
      this.invalidateThumb(rasterId);
      this.callbacks.onDocumentNeeds?.([rasterId]);
      this.pendingEncodeIds.add(rasterId);
      return;
    }
    this.cancelPendingEncode(rasterId);
    const width = Math.max(1, Math.round(undo.width));
    const height = Math.max(1, Math.round(undo.height));
    const dims = this.rasterDimensions.get(rasterId);
    const hot = this.hot.get(rasterId);
    if (
      !dims ||
      dims.width !== width ||
      dims.height !== height ||
      !hot ||
      hot.width !== width ||
      hot.height !== height
    ) {
      this.disposeRaster(rasterId);
      if (isClipRasterId(rasterId)) {
        this.registerClipRaster(rasterId, width, height);
      } else {
        this.rasterDimensions.set(rasterId, { width, height });
      }
    }
    this.bumpHotRevision(rasterId);
    const canvas = this.decode(rasterId);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(undo, 0, 0);
    }
    this.invalidateThumb(rasterId);
    this.callbacks.onDocumentNeeds?.([rasterId]);
    this.pendingEncodeIds.add(rasterId);
  }

  restoreRasterFromPng(rasterId: string, png: ArrayBuffer): void {
    this.cancelPendingEncode(rasterId);
    this.callbacks.onDocumentNeeds?.([rasterId]);
    this.noteEncodedPng(rasterId, png);
    this.bumpHotRevision(rasterId);
    const canvas = this.hot.get(rasterId);
    if (canvas) {
      const dims = this.getRasterDimensions(rasterId);
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, dims.width, dims.height);
      this.blitEncodedPng(canvas, png, rasterId, this.bumpBlitEpoch(rasterId));
    }
    this.invalidateThumb(rasterId);
    void this.generateThumb(rasterId);
    if (this.hot.has(rasterId) && tryDecodeInkSnapshot(png)) {
      this.startEncode(rasterId);
    }
  }

  private cancelPendingEncode(rasterId: string): void {
    if (!this.pendingEncodes.has(rasterId)) {
      return;
    }
    this.encodeGeneration.set(rasterId, (this.encodeGeneration.get(rasterId) ?? 0) + 1);
    this.pendingEncodes.delete(rasterId);
    this.deferredHotRefresh.delete(rasterId);
    this.callbacks.onEncodingAborted?.(rasterId);
  }

  captureRasterPng(rasterId: string): ArrayBuffer | undefined {
    const encoded = this.encodedPng.get(rasterId);
    return encoded ? encoded.slice(0) : undefined;
  }

  /**
   * Live pixels for undo/redo capture. encodedPng lags behind hot until the deferred encode
   * finishes, so prefer a copy of the hot canvas; fall back to the encoded PNG when not hot.
   */
  captureRasterPixels(rasterId: string, like?: InkUndoPixels): InkUndoPixels | undefined {
    if (like && isInkUndoPatch(like)) {
      const canvas = this.decodeForEdit(rasterId);
      if (!this.blitPending.has(rasterId)) {
        const rect = { x: like.x, y: like.y, width: like.canvas.width, height: like.canvas.height };
        return { canvas: cropCanvasToRect(canvas, rect, (w, h) => this.canvasFactory(w, h)), x: like.x, y: like.y };
      }
    }
    const hot = this.hot.get(rasterId);
    if (hot) {
      const copy = this.canvasFactory(hot.width, hot.height);
      const ctx = copy.getContext('2d');
      if (ctx) {
        ctx.drawImage(hot as unknown as CanvasImageSource, 0, 0);
        return copy as unknown as InkUndoPixels;
      }
    }
    return this.captureRasterPng(rasterId);
  }

  invalidateThumb(rasterId: string): void {
    const thumb = this.thumbs.get(rasterId);
    if (thumb) {
      thumb.close();
      this.thumbs.delete(rasterId);
    }
    this.thumbGeneration.set(rasterId, (this.thumbGeneration.get(rasterId) ?? 0) + 1);
  }

  getThumb(rasterId: string): ImageBitmap | undefined {
    return this.thumbs.get(rasterId);
  }

  subscribeThumbReady(listener: (rasterId: string) => void): () => void {
    this.thumbReadyListeners.add(listener);
    return () => {
      this.thumbReadyListeners.delete(listener);
    };
  }

  private notifyThumbReady(rasterId: string): void {
    for (const listener of this.thumbReadyListeners) {
      listener(rasterId);
    }
  }

  private isPageRasterId(rasterId: string): boolean {
    return rasterId.includes(':page:');
  }

  /**
   * Draw ink onto a 144×204 thumb context without creating a hot canvas when
   * the page is only encoded.
   */
  private async drawInkSourceOntoThumb(
    ctx: Ink2DContext,
    rasterId: string,
    destWidth: number,
    destHeight: number,
  ): Promise<void> {
    const hot = this.hot.get(rasterId);
    if (hot) {
      drawInkOntoThumbCanvas(
        ctx,
        hot as unknown as CanvasImageSource & { width: number; height: number },
        destWidth,
        destHeight,
      );
      const overlay = this.overlays.get(rasterId);
      if (overlay) {
        drawInkOntoThumbCanvas(
          ctx,
          overlay as unknown as CanvasImageSource & { width: number; height: number },
          destWidth,
          destHeight,
        );
      }
      return;
    }

    const png = this.encodedPng.get(rasterId);
    if (!png || png.byteLength === 0) {
      return;
    }

    const snapshot = tryDecodeInkSnapshot(png);
    if (snapshot) {
      const src = this.canvasFactory(snapshot.width, snapshot.height);
      const srcCtx = src.getContext('2d');
      if (!srcCtx) {
        return;
      }
      try {
        const imageData =
          typeof ImageData !== 'undefined'
            ? new ImageData(snapshot.data, snapshot.width, snapshot.height)
            : ({ data: snapshot.data, width: snapshot.width, height: snapshot.height } as ImageData);
        srcCtx.putImageData(imageData, 0, 0);
        drawInkOntoThumbCanvas(
          ctx,
          src as unknown as CanvasImageSource & { width: number; height: number },
          destWidth,
          destHeight,
        );
      } catch {
        /* malformed snapshot */
      }
      return;
    }

    if (!isPngBuffer(png) || typeof createImageBitmap === 'undefined') {
      return;
    }
    const blob = new Blob([png.slice(0)], { type: 'image/png' });
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(blob, {
        resizeWidth: destWidth,
        resizeHeight: destHeight,
        resizeQuality: 'low',
      });
    } catch {
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        return;
      }
    }
    drawInkOntoThumbCanvas(ctx, bitmap, destWidth, destHeight);
    bitmap.close();
  }

  /**
   * §9.7: composite template + ink at 144×204. Text is not baked (DOM-only).
   * Does not decode into hot when the raster is only in encodedPng.
   */
  async generateThumb(rasterId: string): Promise<ImageBitmap | undefined> {
    const generation = (this.thumbGeneration.get(rasterId) ?? 0) + 1;
    this.thumbGeneration.set(rasterId, generation);

    const dest = isClipRasterId(rasterId)
      ? fitClipThumbSize(this.getRasterDimensions(rasterId).width, this.getRasterDimensions(rasterId).height)
      : { width: THUMB_WIDTH, height: THUMB_HEIGHT };

    const thumbCanvas = this.canvasFactory(dest.width, dest.height);
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    if (this.drawTemplate && this.isPageRasterId(rasterId)) {
      this.drawTemplate(ctx, dest.width, dest.height);
    }

    if ('imageSmoothingEnabled' in ctx) {
      ctx.imageSmoothingEnabled = true;
    }
    if ('imageSmoothingQuality' in ctx) {
      ctx.imageSmoothingQuality = 'low';
    }

    await this.drawInkSourceOntoThumb(ctx, rasterId, dest.width, dest.height);
    if (this.thumbGeneration.get(rasterId) !== generation) {
      return undefined;
    }

    let bitmap: ImageBitmap;
    try {
      bitmap = await this.createThumbBitmap(thumbCanvas);
    } catch {
      return undefined;
    }
    if (this.thumbGeneration.get(rasterId) !== generation) {
      bitmap.close();
      return undefined;
    }

    const prev = this.thumbs.get(rasterId);
    if (prev) {
      prev.close();
    }
    this.thumbs.set(rasterId, bitmap);
    this.notifyThumbReady(rasterId);
    return bitmap;
  }

  isEncoding(rasterId: string): boolean {
    return this.pendingEncodes.has(rasterId);
  }

  restartEncode(rasterId: string): void {
    if (this.hot.has(rasterId)) {
      this.startEncode(rasterId);
    }
  }

  /**
   * §9.4: cut page rect into a new clip canvas (drawImage + clearRect).
   * Empty ink → no clip (`trim` null). Otherwise clip is cropped to ink bounds.
   */
  marqueeCut(
    pageRasterId: string,
    clipRasterId: string,
    rect: { x: number; y: number; width: number; height: number },
  ): { pageUndo: InkUndoPixels; trim: { x: number; y: number; width: number; height: number } | null } {
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.registerClipRaster(clipRasterId, w, h);
    const clip = this.decode(clipRasterId);
    const page = this.decodeForEdit(pageRasterId);
    canvasCopyPageRect(page, clip, rect);
    const trim = inkAlphaBounds(clip);
    inkLog('InkEngine.marqueeCut', 'cut', {
      pageRasterId,
      clipRasterId,
      rect,
      trim,
      pageHot: this.hot.has(pageRasterId),
      pagePngBytes: this.encodedPng.get(pageRasterId)?.byteLength ?? 0,
      pendingEncode: this.pendingEncodes.has(pageRasterId),
      pendingEncodeId: this.pendingEncodeIds.has(pageRasterId),
    });
    if (!trim) {
      this.disposeRaster(clipRasterId);
      return { pageUndo: new ArrayBuffer(0), trim: null };
    }
    this.captureStrokeUndo(pageRasterId);
    const pageCtx = page.getContext('2d');
    if (!pageCtx) {
      this.disposeRaster(clipRasterId);
      return { pageUndo: new ArrayBuffer(0), trim: null };
    }
    pageCtx.clearRect(Math.round(rect.x), Math.round(rect.y), w, h);
    if (trim.x !== 0 || trim.y !== 0 || trim.width !== clip.width || trim.height !== clip.height) {
      const cropped = cropCanvasToRect(clip, trim, (cw, ch) => this.canvasFactory(cw, ch));
      this.hot.set(clipRasterId, cropped);
      this.rasterDimensions.set(clipRasterId, { width: trim.width, height: trim.height });
    }
    this.bumpHotRevision(pageRasterId);
    this.bumpHotRevision(clipRasterId);
    const pageUndo = this.takeStrokeUndoSnapshot(pageRasterId);
    this.invalidateThumb(pageRasterId);
    this.invalidateThumb(clipRasterId);
    this.callbacks.onDocumentNeeds?.([pageRasterId, clipRasterId]);
    this.startEncode(pageRasterId);
    this.startEncode(clipRasterId);
    void this.generateThumb(pageRasterId);
    void this.generateThumb(clipRasterId);
    this.callbacks.onBake?.(pageRasterId);
    this.callbacks.onBake?.(clipRasterId);
    return { pageUndo, trim };
  }

  /**
   * Cut page ink inside a polygon, then crop the clip to a rectangle (ink AABB).
   * Empty ink → no clip (`trim` null).
   */
  lassoCut(
    pageRasterId: string,
    clipRasterId: string,
    points: Array<{ x: number; y: number }>,
    rect: { x: number; y: number; width: number; height: number },
  ): { pageUndo: InkUndoPixels; trim: { x: number; y: number; width: number; height: number } | null } {
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.registerClipRaster(clipRasterId, w, h);
    const clip = this.decode(clipRasterId);
    const page = this.decodeForEdit(pageRasterId);
    canvasCopyLassoRegion(page, clip, points, rect, (cw, ch) => this.canvasFactory(cw, ch));
    const trim = inkAlphaBounds(clip);
    inkLog('InkEngine.lassoCut', 'cut', {
      pageRasterId,
      clipRasterId,
      rect,
      trim,
      pageHot: this.hot.has(pageRasterId),
      pagePngBytes: this.encodedPng.get(pageRasterId)?.byteLength ?? 0,
      pendingEncode: this.pendingEncodes.has(pageRasterId),
      pendingEncodeId: this.pendingEncodeIds.has(pageRasterId),
    });
    if (!trim) {
      this.disposeRaster(clipRasterId);
      return { pageUndo: new ArrayBuffer(0), trim: null };
    }
    this.captureStrokeUndo(pageRasterId);
    canvasClearLassoPolygon(page, points);
    if (trim.x !== 0 || trim.y !== 0 || trim.width !== clip.width || trim.height !== clip.height) {
      const cropped = cropCanvasToRect(clip, trim, (cw, ch) => this.canvasFactory(cw, ch));
      this.hot.set(clipRasterId, cropped);
      this.rasterDimensions.set(clipRasterId, { width: trim.width, height: trim.height });
    }
    this.bumpHotRevision(pageRasterId);
    this.bumpHotRevision(clipRasterId);
    const pageUndo = this.takeStrokeUndoSnapshot(pageRasterId);
    this.invalidateThumb(pageRasterId);
    this.invalidateThumb(clipRasterId);
    this.callbacks.onDocumentNeeds?.([pageRasterId, clipRasterId]);
    this.startEncode(pageRasterId);
    this.startEncode(clipRasterId);
    void this.generateThumb(pageRasterId);
    void this.generateThumb(clipRasterId);
    this.callbacks.onBake?.(pageRasterId);
    this.callbacks.onBake?.(clipRasterId);
    return { pageUndo, trim };
  }

  /**
   * Cut ink inside a clip-local polygon into a new clip raster.
   * `pieceOrigin` is the piece AABB in the original source pixels (or null if empty).
   * `sourceTrim` is the remaining-ink AABB in original source pixels (null if the source is empty).
   */
  cutClipRegion(
    sourceRasterId: string,
    destRasterId: string,
    points: Array<{ x: number; y: number }>,
  ): {
    sourceUndo: InkUndoPixels;
    pieceOrigin: { x: number; y: number; width: number; height: number } | null;
    sourceTrim: { x: number; y: number; width: number; height: number } | null;
  } {
    const empty = {
      sourceUndo: new ArrayBuffer(0) as InkUndoPixels,
      pieceOrigin: null,
      sourceTrim: null,
    };
    const aabb = polygonAabb(points);
    if (!aabb) {
      return empty;
    }
    const sourceDims = this.getRasterDimensions(sourceRasterId);
    const copyRect = intersectRects(aabb, { x: 0, y: 0, width: sourceDims.width, height: sourceDims.height });
    if (!copyRect || copyRect.width < 1 || copyRect.height < 1) {
      return empty;
    }
    const w = Math.max(1, Math.round(copyRect.width));
    const h = Math.max(1, Math.round(copyRect.height));
    this.registerClipRaster(destRasterId, w, h);
    const dest = this.decode(destRasterId);
    const source = this.decodeForEdit(sourceRasterId);
    canvasCopyLassoRegion(source, dest, points, copyRect, (cw, ch) => this.canvasFactory(cw, ch));
    const pieceBounds = inkAlphaBounds(dest);
    if (!pieceBounds) {
      this.disposeRaster(destRasterId);
      return empty;
    }
    const pieceOrigin = {
      x: copyRect.x + pieceBounds.x,
      y: copyRect.y + pieceBounds.y,
      width: pieceBounds.width,
      height: pieceBounds.height,
    };
    if (
      pieceBounds.x !== 0 ||
      pieceBounds.y !== 0 ||
      pieceBounds.width !== dest.width ||
      pieceBounds.height !== dest.height
    ) {
      const cropped = cropCanvasToRect(dest, pieceBounds, (cw, ch) => this.canvasFactory(cw, ch));
      this.hot.set(destRasterId, cropped);
      this.rasterDimensions.set(destRasterId, { width: pieceBounds.width, height: pieceBounds.height });
    }

    this.captureStrokeUndo(sourceRasterId);
    canvasClearLassoPolygon(source, points);
    const sourceTrim = inkAlphaBounds(source);
    if (sourceTrim) {
      if (
        sourceTrim.x !== 0 ||
        sourceTrim.y !== 0 ||
        sourceTrim.width !== source.width ||
        sourceTrim.height !== source.height
      ) {
        const croppedSource = cropCanvasToRect(source, sourceTrim, (cw, ch) => this.canvasFactory(cw, ch));
        this.hot.set(sourceRasterId, croppedSource);
        this.rasterDimensions.set(sourceRasterId, { width: sourceTrim.width, height: sourceTrim.height });
      }
    }

    this.bumpHotRevision(sourceRasterId);
    this.bumpHotRevision(destRasterId);
    const sourceUndo = this.takeStrokeUndoSnapshot(sourceRasterId);
    this.invalidateThumb(sourceRasterId);
    this.invalidateThumb(destRasterId);
    this.callbacks.onDocumentNeeds?.([sourceRasterId, destRasterId]);
    this.startEncode(sourceRasterId);
    this.startEncode(destRasterId);
    void this.generateThumb(sourceRasterId);
    void this.generateThumb(destRasterId);
    this.callbacks.onBake?.(sourceRasterId);
    this.callbacks.onBake?.(destRasterId);
    return { sourceUndo, pieceOrigin, sourceTrim };
  }

  /**
   * §9.4: transform-draw clip onto page, dispose live clip raster.
   * Returns page snapshot plus the clip canvas for history (undo restores the clip).
   */
  bakeClipOntoPage(
    pageRasterId: string,
    clipRasterId: string,
    pageLocalX: number,
    pageLocalY: number,
    scale: number,
    rotation: number,
    scaleY: number = scale,
  ): { pageUndo: InkUndoPixels; clipUndo: InkUndoPixels } {
    const clipDims = this.getRasterDimensions(clipRasterId);
    this.captureStrokeUndo(pageRasterId);
    const page = this.decodeForEdit(pageRasterId);
    const clip = this.decodeForEdit(clipRasterId);
    const pageCtx = page.getContext('2d');
    if (!pageCtx) {
      throw new Error(`bakeClipOntoPage: page context unavailable for ${pageRasterId}`);
    }
    canvasBakeClipOntoPage(
      pageCtx,
      clip,
      clipDims.width,
      clipDims.height,
      pageLocalX,
      pageLocalY,
      scale,
      rotation,
      scaleY,
    );
    const pageUndo = this.takeStrokeUndoSnapshot(pageRasterId);
    this.disposeRaster(clipRasterId);
    this.invalidateThumb(pageRasterId);
    void this.generateThumb(pageRasterId);
    this.callbacks.onDocumentNeeds?.([pageRasterId]);
    this.startEncode(pageRasterId);
    this.callbacks.onBake?.(pageRasterId);
    return { pageUndo, clipUndo: clip };
  }

  /**
   * Composite source clips onto a new raster with baked scale/rotation.
   * Sources stay hot so document undo can restore them. Empty ink → dispose dest.
   */
  mergeClipsOntoRaster(
    destRasterId: string,
    destWidth: number,
    destHeight: number,
    sources: ReadonlyArray<{
      rasterId: string;
      destLocalX: number;
      destLocalY: number;
      scale: number;
      rotation: number;
      scaleY?: number;
    }>,
  ): { trim: { x: number; y: number; width: number; height: number } | null } {
    const w = Math.max(1, Math.round(destWidth));
    const h = Math.max(1, Math.round(destHeight));
    this.registerClipRaster(destRasterId, w, h);
    const dest = this.decode(destRasterId);
    const destCtx = dest.getContext('2d');
    if (!destCtx) {
      this.disposeRaster(destRasterId);
      return { trim: null };
    }
    destCtx.clearRect(0, 0, dest.width, dest.height);
    for (const source of sources) {
      const dims = this.getRasterDimensions(source.rasterId);
      const clip = this.decodeForEdit(source.rasterId);
      canvasBakeClipOntoPage(
        destCtx,
        clip,
        dims.width,
        dims.height,
        source.destLocalX,
        source.destLocalY,
        source.scale,
        source.rotation,
        source.scaleY ?? source.scale,
      );
    }
    const trim = inkAlphaBounds(dest);
    if (!trim) {
      this.disposeRaster(destRasterId);
      return { trim: null };
    }
    if (trim.x !== 0 || trim.y !== 0 || trim.width !== dest.width || trim.height !== dest.height) {
      const cropped = cropCanvasToRect(dest, trim, (cw, ch) => this.canvasFactory(cw, ch));
      this.hot.set(destRasterId, cropped);
      this.rasterDimensions.set(destRasterId, { width: trim.width, height: trim.height });
    }
    this.bumpHotRevision(destRasterId);
    this.invalidateThumb(destRasterId);
    this.callbacks.onDocumentNeeds?.([destRasterId]);
    this.startEncode(destRasterId);
    void this.generateThumb(destRasterId);
    this.callbacks.onBake?.(destRasterId);
    return { trim };
  }

  private captureStrokeUndo(rasterId: string): void {
    this.strokeBounds.delete(rasterId);
    const page = this.decodeForEdit(rasterId);
    const dims = this.getRasterDimensions(rasterId);
    const snapshot = this.canvasFactory(dims.width, dims.height);
    const snapCtx = snapshot.getContext('2d');
    const pageCtx = page.getContext('2d');
    if (!snapCtx || !pageCtx) {
      return;
    }
    snapCtx.drawImage(page as unknown as CanvasImageSource, 0, 0);
    this.strokeUndoCanvas.set(rasterId, snapshot);
  }

  /** Canvas snapshot from stroke start; no getImageData. Empty buffer if missing. */
  takeStrokeUndoSnapshot(rasterId: string): InkUndoPixels {
    const snapshot = this.strokeUndoCanvas.get(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
    return snapshot ? this.cropStrokeUndo(rasterId, snapshot) : new ArrayBuffer(0);
  }

  /** Snapshot undo PNG captured at stroke start; clears the pending snapshot. */
  takeStrokeUndoPng(rasterId: string): ArrayBuffer {
    const snapshot = this.strokeUndoCanvas.get(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
    this.strokeBounds.delete(rasterId);
    return snapshot ? this.canvasToUndoBuffer(snapshot) : new ArrayBuffer(0);
  }

  private stashUndoSnapshot(rasterId: string): void {
    const snapshot = this.strokeUndoCanvas.get(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
    if (snapshot) {
      this.pendingUndo.push({ rasterId, canvas: this.cropStrokeUndo(rasterId, snapshot) });
    }
  }

  private canvasToUndoBuffer(snapshot: InkCanvas): ArrayBuffer {
    const ctx = snapshot.getContext('2d');
    if (!ctx) {
      return new ArrayBuffer(0);
    }
    const width = snapshot.width;
    const height = snapshot.height;
    const image = ctx.getImageData(0, 0, width, height);
    const header = new ArrayBuffer(8);
    new DataView(header).setUint32(0, width);
    new DataView(header).setUint32(4, height);
    const out = new Uint8Array(8 + image.data.length);
    out.set(new Uint8Array(header), 0);
    out.set(image.data, 8);
    return out.buffer;
  }

  private async encodeLimited(canvas: InkCanvas): Promise<ArrayBuffer> {
    if (this.activeEncodes >= MAX_CONCURRENT_ENCODES) {
      await new Promise<void>((resolve) => this.encodeWaiters.push(resolve));
    }
    this.activeEncodes += 1;
    try {
      return await this.encodePng(canvas);
    } finally {
      this.activeEncodes -= 1;
      this.encodeWaiters.shift()?.();
    }
  }

  private startEncode(rasterId: string, attempt = 1): void {
    const canvas = this.hot.get(rasterId);
    if (!canvas) {
      inkLog('InkEngine.startEncode', 'encode skipped: no hot canvas', { rasterId });
      return;
    }
    const gen = (this.encodeGeneration.get(rasterId) ?? 0) + 1;
    this.encodeGeneration.set(rasterId, gen);
    const hotRevisionAtStart = this.hotRevision.get(rasterId) ?? 0;
    inkLog('InkEngine.startEncode', 'encode start', { rasterId, attempt, gen, w: canvas.width, h: canvas.height });
    this.pendingEncodes.add(rasterId);
    this.callbacks.onEncodingStarted?.(rasterId);
    void this.encodeLimited(canvas)
      .then((buffer) => {
        if (this.encodeGeneration.get(rasterId) !== gen) {
          return;
        }
        const revisionNow = this.hotRevision.get(rasterId) ?? 0;
        if (revisionNow !== hotRevisionAtStart) {
          this.pendingEncodes.delete(rasterId);
          this.startEncode(rasterId, attempt);
          return;
        }
        inkLog('InkEngine.startEncode', 'encode done', {
          rasterId,
          bytes: buffer.byteLength,
          prevBytes: this.encodedPng.get(rasterId)?.byteLength ?? 0,
          deferredRefresh: this.deferredHotRefresh.has(rasterId),
        });
        this.noteEncodedPng(rasterId, buffer);
        this.pendingEncodes.delete(rasterId);
        if (this.deferredHotRefresh.delete(rasterId)) {
          const hot = this.hot.get(rasterId);
          if (hot) {
            const epoch = this.bumpBlitEpoch(rasterId);
            this.blitEncodedPng(hot, buffer, rasterId, epoch);
          }
        }
        this.callbacks.onEncodingComplete?.(rasterId, buffer);
      })
      .catch((err) => {
        inkLog('InkEngine.startEncode', 'encode error', {
          rasterId,
          attempt,
          staleGen: this.encodeGeneration.get(rasterId) !== gen,
          msg: err instanceof Error ? err.message : String(err),
        });
        if (this.encodeGeneration.get(rasterId) !== gen) {
          return;
        }
        if (attempt >= ENCODE_MAX_ATTEMPTS) {
          this.pendingEncodes.delete(rasterId);
          this.callbacks.onEncodingFailed?.(rasterId);
          return;
        }
        // Keep pendingEncodes set so waiters and LRU treat it as in flight while backing off.
        setTimeout(() => {
          if (this.encodeGeneration.get(rasterId) !== gen) {
            return;
          }
          this.pendingEncodes.delete(rasterId);
          this.startEncode(rasterId, attempt + 1);
        }, ENCODE_RETRY_BASE_MS * attempt);
      });
  }
}

export function createInkRestoreSink(engine: InkEngine): {
  restoreRaster(rasterId: string, png: InkUndoPixels): void;
  captureRaster(rasterId: string, like?: InkUndoPixels): InkUndoPixels | undefined;
  invalidateThumb(rasterId: string): void;
} {
  return {
    restoreRaster: (rasterId, png) => engine.restoreRasterFromUndo(rasterId, png),
    captureRaster: (rasterId, like) => engine.captureRasterPixels(rasterId, like),
    invalidateThumb: (rasterId) => engine.invalidateThumb(rasterId),
  };
}

export function wireInkAutosave(engine: InkEngine, sink: InkAutosaveSink): () => void {
  engine.setCallbacks({
    onEncodingStarted: (rasterId) => sink.notifyEncodingStarted(rasterId),
    onEncodingComplete: (rasterId, buffer) => {
      sink.notifyEncodingComplete(rasterId, buffer);
      sink.scheduleDocumentSave([rasterId]);
    },
    onEncodingFailed: (rasterId) => sink.notifyEncodingFailed?.(rasterId),
    onEncodingAborted: (rasterId) => sink.notifyEncodingAborted?.(rasterId),
    onDocumentNeeds: (rasterIds) => sink.notifyDocumentNeeds?.(rasterIds),
    onBake: (rasterId) => sink.scheduleDocumentSave([rasterId]),
  });
  return () => engine.setCallbacks({});
}
