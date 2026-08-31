import { rangeSelectBody, stripRuby, sortBodyReadingOrder } from './pdfText';
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

function isVerticalPdfRun(item: PdfTextItem): boolean {
  const em = Math.max(1, item.fontSize || item.width || 1);
  const h = item.height || em;
  const w = item.width || em;
  return h > em * 1.35 && h >= w;
}

export function pdfItemToView(
  item: PdfTextItem,
  viewW: number,
  viewH: number,
  media = DEFAULT_PDF_MEDIA,
): Rect {
  const em = Math.max(1, item.fontSize || 1);
  const glyphW = Math.max(1, item.width || em);
  const glyphH = Math.max(1, item.height || em);
  const pdfX = item.x;
  const pdfH = glyphH;
  const pdfW = isVerticalPdfRun(item) ? Math.max(glyphW, em) : glyphW;
  const pdfY = isVerticalPdfRun(item) ? item.y - pdfH : item.y;
  return {
    x: (pdfX / media.width) * viewW,
    y: (1 - (pdfY + pdfH) / media.height) * viewH,
    width: Math.max(1, (pdfW / media.width) * viewW),
    height: Math.max(1, (pdfH / media.height) * viewH),
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

export function unionPdfItems(items: readonly PdfTextItem[]): Rect | null {
  if (items.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function distToRect(x: number, y: number, rect: Rect): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function hitBodyReadingIndex(
  source: readonly PdfTextItem[],
  viewX: number,
  viewY: number,
  viewW: number,
  viewH: number,
  media = DEFAULT_PDF_MEDIA,
  slop = 0,
): number | null {
  const sorted = sortBodyReadingOrder(source);
  let bestExact: number | null = null;
  let bestExactArea = Infinity;
  let nearest: number | null = null;
  let nearestDist = Infinity;
  for (let i = 0; i < sorted.length; i += 1) {
    const rect = pdfItemToView(sorted[i], viewW, viewH, media);
    if (
      viewX >= rect.x &&
      viewX <= rect.x + rect.width &&
      viewY >= rect.y &&
      viewY <= rect.y + rect.height
    ) {
      const area = rect.width * rect.height;
      if (area < bestExactArea) {
        bestExactArea = area;
        bestExact = i;
      }
    }
    const dist = distToRect(viewX, viewY, rect);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = i;
    }
  }
  if (bestExact != null) {
    return bestExact;
  }
  if (slop > 0 && nearest != null && nearestDist <= slop) {
    const nearestRect = pdfItemToView(sorted[nearest], viewW, viewH, media);
    const dx = Math.max(nearestRect.x - viewX, 0, viewX - (nearestRect.x + nearestRect.width));
    if (dx <= slop) {
      return nearest;
    }
  }
  return null;
}
