import { PDF_MAX_EDGE } from './constants';
import { computeLetterbox, renderScaleForPage } from './pdfLetterbox';
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
): Promise<RenderTask | null> {
  const page = await proxy.getPage(pageNumber);
  const viewport1 = page.getViewport({ scale: 1 });
  const letterbox = computeLetterbox(
    layout.containerWidth,
    layout.containerHeight,
    viewport1.width,
    viewport1.height,
  );
  const cssW = letterbox.width;
  const cssH = letterbox.height;
  const scale = renderScaleForPage(
    viewport1.width,
    viewport1.height,
    cssW,
    cssH,
    layout.zoom,
    layout.dpr,
    layout.maxEdge ?? PDF_MAX_EDGE,
  );
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssW * Math.max(0.01, layout.zoom)}px`;
  canvas.style.height = `${cssH * Math.max(0.01, layout.zoom)}px`;

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
  };
}

export function pageMediaSize(
  pageWidth: number,
  pageHeight: number,
): { width: number; height: number } {
  return { width: pageWidth, height: pageHeight };
}
