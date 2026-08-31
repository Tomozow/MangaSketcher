import { PDF_MAX_EDGE } from './constants';
import { computeLetterbox, renderScaleForPage } from './pdfLetterbox';
import type { PdfCachedBitmap } from './pdfPageCache';
import type { PdfDocumentProxy } from './pdfSession';

type RenderTask = {
  cancel: () => void;
  promise: Promise<void>;
};

export type PdfRenderLayout = {
  containerWidth: number;
  containerHeight: number;
  zoom: number;
  dpr: number;
  maxEdge?: number;
};

export type PdfRenderHandle = RenderTask & {
  scale: number;
  cssWidth: number;
  cssHeight: number;
};

export function resolvePdfRenderMetrics(
  pageWidth: number,
  pageHeight: number,
  layout: PdfRenderLayout,
): { scale: number; cssWidth: number; cssHeight: number } {
  const letterbox = computeLetterbox(
    layout.containerWidth,
    layout.containerHeight,
    pageWidth,
    pageHeight,
  );
  const scale = renderScaleForPage(
    pageWidth,
    pageHeight,
    letterbox.width,
    letterbox.height,
    layout.zoom,
    layout.dpr,
    layout.maxEdge ?? PDF_MAX_EDGE,
  );
  return { scale, cssWidth: letterbox.width, cssHeight: letterbox.height };
}

export function blitPdfBitmapToCanvas(
  canvas: HTMLCanvasElement,
  bitmap: PdfCachedBitmap,
  cssWidth: number,
  cssHeight: number,
  zoom: number,
): void {
  const width = Math.max(1, Math.floor(bitmap.width));
  const height = Math.max(1, Math.floor(bitmap.height));
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${cssWidth * Math.max(0.01, zoom)}px`;
  canvas.style.height = `${cssHeight * Math.max(0.01, zoom)}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
}

function isPdfRenderCancelled(err: unknown): boolean {
  if (err == null || typeof err !== 'object') {
    return false;
  }
  const name = 'name' in err ? String((err as { name: unknown }).name) : '';
  const message = 'message' in err ? String((err as { message: unknown }).message) : '';
  return name === 'RenderingCancelledException' || message.startsWith('Rendering cancelled');
}

export async function renderPdfPageToCanvas(
  proxy: PdfDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  layout: PdfRenderLayout,
): Promise<PdfRenderHandle | null> {
  const page = await proxy.getPage(pageNumber);
  const viewport1 = page.getViewport({ scale: 1 });
  const metrics = resolvePdfRenderMetrics(viewport1.width, viewport1.height, layout);
  const viewport = page.getViewport({ scale: metrics.scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${metrics.cssWidth * Math.max(0.01, layout.zoom)}px`;
  canvas.style.height = `${metrics.cssHeight * Math.max(0.01, layout.zoom)}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const task = page.render({ canvasContext: ctx, viewport });
  const promise = task.promise.catch((err: unknown) => {
    if (isPdfRenderCancelled(err)) {
      return;
    }
    throw err;
  });
  return {
    cancel: () => {
      try {
        task.cancel();
      } catch (err) {
        if (!isPdfRenderCancelled(err)) {
          throw err;
        }
      }
    },
    promise,
    scale: metrics.scale,
    cssWidth: metrics.cssWidth,
    cssHeight: metrics.cssHeight,
  };
}

let scratchCanvas: HTMLCanvasElement | null = null;

export function getPdfScratchCanvas(): HTMLCanvasElement {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
  }
  return scratchCanvas;
}

export function pageMediaSize(
  pageWidth: number,
  pageHeight: number,
): { width: number; height: number } {
  return { width: pageWidth, height: pageHeight };
}
