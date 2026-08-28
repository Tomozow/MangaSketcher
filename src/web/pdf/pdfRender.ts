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
};

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
    PDF_MAX_EDGE,
  );
  const viewport = page.getViewport({ scale: scale * layout.zoom });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const task = page.render({ canvasContext: ctx, viewport });
  return {
    cancel: () => {
      task.cancel();
    },
    promise: task.promise,
  };
}

export function pageMediaSize(
  pageWidth: number,
  pageHeight: number,
): { width: number; height: number } {
  return { width: pageWidth, height: pageHeight };
}
