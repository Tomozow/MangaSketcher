import { canvasBakeClipOntoPage, canvasMarqueeCut } from '../clip/clipCanvas';
import { isPngBuffer, tryDecodeInkSnapshot } from './fakeCanvas';

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
  onBake?: (rasterId: string) => void;
  /** Encoded pixels landed on the hot canvas (sync snapshot or async PNG). */
  onHotPixelsReady?: (rasterId: string) => void;
};

export type InkAutosaveSink = {
  notifyEncodingStarted(rasterId: string): void;
  notifyEncodingComplete(rasterId: string, buffer: ArrayBuffer): void;
  scheduleDocumentSave(dirtyRasterIds: string[]): void;
};

const HOT_CANVAS_LIMIT = 8;

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
  private readonly pendingUndo: { rasterId: string; canvas: InkCanvas }[] = [];
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
      this.rasterDimensions.set(rasterId, { width: this.rasterWidth, height: this.rasterHeight });
    }
    const stored = this.encodedPng.get(rasterId);
    const storedLen = stored?.byteLength ?? 0;
    const canvas = this.hot.get(rasterId);
    if (canvas && stored && storedLen > 0 && storedLen !== prevLen) {
      this.blitEncodedPng(canvas, stored, rasterId, this.bumpBlitEpoch(rasterId));
    }
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
    this.hot.delete(rasterId);
    this.overlays.delete(rasterId);
    this.overlayCtx.delete(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
    this.encodedPng.delete(rasterId);
    this.rasterDimensions.delete(rasterId);
    this.blitEpoch.delete(rasterId);
    this.encodedGeneration.delete(rasterId);
    this.deferredHotRefresh.delete(rasterId);
    this.hotRevision.delete(rasterId);
    this.encodeGeneration.delete(rasterId);
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

  private touchLru(rasterId: string): void {
    const idx = this.lru.indexOf(rasterId);
    if (idx >= 0) {
      this.lru.splice(idx, 1);
    }
    this.lru.push(rasterId);
    while (this.lru.length > HOT_CANVAS_LIMIT) {
      const evictIdx = this.lru.findIndex(
        (id) =>
          !this.pinnedHotRasterIds.has(id) &&
          !this.overlays.has(id) &&
          !this.strokeUndoCanvas.has(id) &&
          !this.pendingEncodes.has(id),
      );
      if (evictIdx < 0) {
        break;
      }
      const evictId = this.lru.splice(evictIdx, 1)[0];
      if (evictId) {
        this.hot.delete(evictId);
      }
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
    void this.blitEncodedPngAsync(
      canvas,
      png,
      rasterId,
      epoch,
      this.encodedGeneration.get(rasterId) ?? 0,
      this.hotRevision.get(rasterId) ?? 0,
    );
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
    this.ensureCanvasSize(rasterId, canvas, bitmap.width, bitmap.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    this.callbacks.onHotPixelsReady?.(rasterId);
  }

  beginPenOverlay(rasterId: string): Ink2DContext {
    this.decode(rasterId);
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

  /** §9.5 display copy: hot page + live pen overlay at CSS size. */
  paintDisplay(ctx: Ink2DContext, rasterId: string, width: number, height: number): void {
    const page = this.decode(rasterId);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(page as unknown as CanvasImageSource, 0, 0, width, height);
    const overlay = this.overlays.get(rasterId);
    if (overlay) {
      ctx.drawImage(overlay as unknown as CanvasImageSource, 0, 0, width, height);
    }
  }

  /**
   * Overlay → page blit only. Heavy undo encode is deferred via drainPendingBakeWork.
   */
  blitPenOverlay(rasterId: string): void {
    const overlay = this.overlays.get(rasterId);
    const page = this.decode(rasterId);
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
  ): { rasterId: string; canvas: InkCanvas }[] {
    const drained: { rasterId: string; canvas: InkCanvas }[] = [];
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
    return found ? this.canvasToUndoBuffer(found.canvas) : new ArrayBuffer(0);
  }

  cancelPenOverlay(rasterId: string): void {
    this.overlays.delete(rasterId);
    this.overlayCtx.delete(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
  }

  /**
   * §9.3: erase directly on page/clip hot canvas. Overlay destination-out is forbidden.
   */
  beginEraseDirect(rasterId: string): Ink2DContext {
    this.captureStrokeUndo(rasterId);
    const ctx = this.decode(rasterId).getContext('2d');
    if (!ctx) {
      throw new Error(`beginEraseDirect: 2d context unavailable for ${rasterId}`);
    }
    return ctx;
  }

  finishEraseDirect(rasterId: string): ArrayBuffer {
    const undoPng = this.takeStrokeUndoPng(rasterId);
    this.bumpHotRevision(rasterId);
    this.invalidateThumb(rasterId);
    void this.generateThumb(rasterId);
    this.startEncode(rasterId);
    this.callbacks.onBake?.(rasterId);
    return undoPng;
  }

  /** Clear all ink on a page/clip raster and return the pre-clear undo snapshot. */
  clearRaster(rasterId: string): ArrayBuffer {
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

  restoreRasterFromUndo(rasterId: string, undo: ArrayBuffer | OffscreenCanvas): void {
    if (undo instanceof ArrayBuffer) {
      this.restoreRasterFromPng(rasterId, undo);
      return;
    }
    this.cancelPendingEncode(rasterId);
    this.bumpHotRevision(rasterId);
    const canvas = this.decode(rasterId);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(undo, 0, 0);
    }
    this.invalidateThumb(rasterId);
    this.pendingEncodeIds.add(rasterId);
  }

  restoreRasterFromPng(rasterId: string, png: ArrayBuffer): void {
    this.cancelPendingEncode(rasterId);
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
  }

  captureRasterPng(rasterId: string): ArrayBuffer | undefined {
    const encoded = this.encodedPng.get(rasterId);
    return encoded ? encoded.slice(0) : undefined;
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

  /**
   * §9.7: composite template + ink at 144×204. Text is not baked (DOM-only).
   */
  async generateThumb(rasterId: string): Promise<ImageBitmap | undefined> {
    const generation = (this.thumbGeneration.get(rasterId) ?? 0) + 1;
    this.thumbGeneration.set(rasterId, generation);

    const page = this.decode(rasterId);
    const thumbCanvas = this.canvasFactory(THUMB_WIDTH, THUMB_HEIGHT);
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    if (this.drawTemplate) {
      this.drawTemplate(ctx, THUMB_WIDTH, THUMB_HEIGHT);
    }

    if ('imageSmoothingEnabled' in ctx) {
      ctx.imageSmoothingEnabled = true;
    }
    if ('imageSmoothingQuality' in ctx) {
      ctx.imageSmoothingQuality = 'medium';
    }

    ctx.drawImage(page as unknown as CanvasImageSource, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);

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
   * §9.4: cut page rect into a new clip canvas (drawImage + clearRect). Returns page undo PNG.
   */
  marqueeCut(
    pageRasterId: string,
    clipRasterId: string,
    rect: { x: number; y: number; width: number; height: number },
  ): ArrayBuffer {
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.registerClipRaster(clipRasterId, w, h);
    this.captureStrokeUndo(pageRasterId);
    const page = this.decode(pageRasterId);
    const clip = this.decode(clipRasterId);
    canvasMarqueeCut(page, clip, rect);
    const pageUndo = this.takeStrokeUndoPng(pageRasterId);
    this.invalidateThumb(pageRasterId);
    this.invalidateThumb(clipRasterId);
    void this.generateThumb(pageRasterId);
    void this.generateThumb(clipRasterId);
    this.startEncode(pageRasterId);
    this.startEncode(clipRasterId);
    this.callbacks.onBake?.(pageRasterId);
    this.callbacks.onBake?.(clipRasterId);
    return pageUndo;
  }

  /**
   * §9.4: transform-draw clip onto page, dispose clip raster. Returns page undo PNG.
   */
  bakeClipOntoPage(
    pageRasterId: string,
    clipRasterId: string,
    pageLocalX: number,
    pageLocalY: number,
    scale: number,
    rotation: number,
  ): ArrayBuffer {
    const clipDims = this.getRasterDimensions(clipRasterId);
    this.captureStrokeUndo(pageRasterId);
    const page = this.decode(pageRasterId);
    const clip = this.decode(clipRasterId);
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
    );
    const pageUndo = this.takeStrokeUndoPng(pageRasterId);
    this.disposeRaster(clipRasterId);
    this.invalidateThumb(pageRasterId);
    void this.generateThumb(pageRasterId);
    this.startEncode(pageRasterId);
    this.callbacks.onBake?.(pageRasterId);
    return pageUndo;
  }

  private captureStrokeUndo(rasterId: string): void {
    const page = this.decode(rasterId);
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

  /** Snapshot undo PNG captured at stroke start; clears the pending snapshot. */
  takeStrokeUndoPng(rasterId: string): ArrayBuffer {
    const snapshot = this.strokeUndoCanvas.get(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
    if (!snapshot) {
      return new ArrayBuffer(0);
    }
    return this.canvasToUndoBuffer(snapshot);
  }

  private stashUndoSnapshot(rasterId: string): void {
    const snapshot = this.strokeUndoCanvas.get(rasterId);
    this.strokeUndoCanvas.delete(rasterId);
    if (snapshot) {
      this.pendingUndo.push({ rasterId, canvas: snapshot });
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

  private startEncode(rasterId: string): void {
    const canvas = this.hot.get(rasterId);
    if (!canvas) {
      return;
    }
    const gen = (this.encodeGeneration.get(rasterId) ?? 0) + 1;
    this.encodeGeneration.set(rasterId, gen);
    const hotRevisionAtStart = this.hotRevision.get(rasterId) ?? 0;
    this.pendingEncodes.add(rasterId);
    this.callbacks.onEncodingStarted?.(rasterId);
    void this.encodePng(canvas)
      .then((buffer) => {
        if (this.encodeGeneration.get(rasterId) !== gen) {
          return;
        }
        const revisionNow = this.hotRevision.get(rasterId) ?? 0;
        if (revisionNow !== hotRevisionAtStart) {
          this.pendingEncodes.delete(rasterId);
          this.startEncode(rasterId);
          return;
        }
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
      .catch(() => {
        if (this.encodeGeneration.get(rasterId) === gen) {
          this.pendingEncodes.delete(rasterId);
        }
      });
  }
}

export function createInkRestoreSink(engine: InkEngine): {
  restoreRaster(rasterId: string, png: ArrayBuffer | OffscreenCanvas): void;
  captureRaster(rasterId: string): ArrayBuffer | undefined;
  invalidateThumb(rasterId: string): void;
} {
  return {
    restoreRaster: (rasterId, png) => engine.restoreRasterFromUndo(rasterId, png),
    captureRaster: (rasterId) => engine.captureRasterPng(rasterId),
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
    onBake: (rasterId) => sink.scheduleDocumentSave([rasterId]),
  });
  return () => engine.setCallbacks({});
}
