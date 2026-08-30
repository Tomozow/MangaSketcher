import type { PdfDocument, PdfExtractedGlyph } from './types';

/** ページ番号が変わるとキーが変わるので、ビューアは再マウント／再描画する。 */
export function pdfPageViewerKey(opfsPath: string, currentPage: number, generation: number): string {
  return `${opfsPath}#g=${generation}#page=${clampPdfPage(currentPage, Number.MAX_SAFE_INTEGER)}`;
}

export function clampPdfPage(page: number, pageCount: number): number {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const n = Math.floor(page);
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.min(count, Math.max(1, n));
}

export const PDF_MIN_ZOOM = 0.25;
export const PDF_MAX_ZOOM = 8;
export const PDF_ZOOM_STEP = 1.25;

export function clampPdfZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, zoom));
}

export function pdfFileFingerprint(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function keepPdfViewOnReload(
  prev: { opfsPath: string; sourceFingerprint?: string } | null | undefined,
  next: { opfsPath: string; fingerprint?: string },
): boolean {
  if (!prev) {
    return false;
  }
  if (prev.sourceFingerprint && next.fingerprint) {
    return prev.sourceFingerprint === next.fingerprint;
  }
  return prev.opfsPath === next.opfsPath;
}

export type PdfViewCarry = {
  currentPage: number;
  zoom: number;
  panX: number;
  panY: number;
  extractedGlyphs: PdfExtractedGlyph[];
  extractMarkersVisible: boolean;
  extractSanitizePunctuation: boolean;
};

export function pdfViewAfterLoad(
  prev: PdfDocument | null | undefined,
  next: { opfsPath: string; pageCount: number; fingerprint?: string },
): PdfViewCarry {
  if (!keepPdfViewOnReload(prev, next) || !prev) {
    return {
      currentPage: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      extractedGlyphs: [],
      extractMarkersVisible: true,
      extractSanitizePunctuation: false,
    };
  }
  return {
    currentPage: clampPdfPage(prev.currentPage, next.pageCount),
    zoom: prev.zoom,
    panX: prev.panX,
    panY: prev.panY,
    extractedGlyphs: [...(prev.extractedGlyphs ?? [])],
    extractMarkersVisible: prev.extractMarkersVisible !== false,
    extractSanitizePunctuation: prev.extractSanitizePunctuation === true,
  };
}
