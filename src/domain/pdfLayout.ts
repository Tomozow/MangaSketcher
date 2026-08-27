import { rangeSelectBody, stripRuby } from './pdfText';
import type { PdfTextItem, Rect } from './types';

/** InDesign landscape novel spread MediaBox (sample.pdf). */
export const DEFAULT_PDF_MEDIA = { width: 1032, height: 729 };

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

export function viewRectToPdf(
  view: Rect,
  viewW: number,
  viewH: number,
  media = DEFAULT_PDF_MEDIA,
  zoom = 1,
  panX = 0,
  panY = 0,
): Rect {
  const w = Math.max(1, viewW);
  const h = Math.max(1, viewH);
  const left = (view.x - panX) / zoom;
  const top = (view.y - panY) / zoom;
  const pdfX = (left / w) * media.width;
  const pdfW = (view.width / zoom / w) * media.width;
  const pdfH = (view.height / zoom / h) * media.height;
  const pdfTopFromTop = (top / h) * media.height;
  const pdfY = media.height - pdfTopFromTop - pdfH;
  return { x: pdfX, y: pdfY, width: pdfW, height: pdfH };
}

export function pdfItemToView(
  item: PdfTextItem,
  viewW: number,
  viewH: number,
  media = DEFAULT_PDF_MEDIA,
): Rect {
  const glyphH = Math.min(item.height || item.fontSize, item.fontSize * 4);
  const glyphW = Math.min(item.width || item.fontSize, viewW);
  return {
    x: (item.x / media.width) * viewW,
    y: (1 - (item.y + glyphH) / media.height) * viewH,
    width: Math.max(4, (glyphW / media.width) * viewW),
    height: Math.max(4, (glyphH / media.height) * viewH),
  };
}

export function selectPdfBodyRange(
  source: readonly PdfTextItem[],
  viewRange: Rect,
  viewW: number,
  viewH: number,
  media = DEFAULT_PDF_MEDIA,
  zoom = 1,
  panX = 0,
  panY = 0,
): PdfTextItem[] {
  const pdfRange = viewRectToPdf(viewRange, viewW, viewH, media, zoom, panX, panY);
  return rangeSelectBody(source, pdfRange);
}

export function bodyItemsForOverlay(source: readonly PdfTextItem[]): PdfTextItem[] {
  return stripRuby(source);
}
