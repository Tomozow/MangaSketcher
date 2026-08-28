export type LetterboxLayout = {
  /** CSS width/height of the PDF canvas box. */
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** Uniform contain scale from PDF media to canvas box. */
  containScale: number;
};

/** Contain-fit media inside a container (§10.2 letterbox). */
export function computeLetterbox(
  containerW: number,
  containerH: number,
  mediaW: number,
  mediaH: number,
): LetterboxLayout {
  const cw = Math.max(1, containerW);
  const ch = Math.max(1, containerH);
  const mw = Math.max(1, mediaW);
  const mh = Math.max(1, mediaH);
  const containScale = Math.min(cw / mw, ch / mh);
  const width = mw * containScale;
  const height = mh * containScale;
  return {
    width,
    height,
    offsetX: (cw - width) / 2,
    offsetY: (ch - height) / 2,
    containScale,
  };
}

/** Render scale so the long edge of the bitmap is at most maxEdge CSS px × dpr. */
export function renderScaleForPage(
  pageWidth: number,
  pageHeight: number,
  cssWidth: number,
  cssHeight: number,
  zoom: number,
  dpr: number,
  maxEdge: number,
): number {
  const longCss = Math.max(cssWidth, cssHeight) * Math.max(1, zoom);
  const longPx = longCss * dpr;
  const base = Math.max(cssWidth, cssHeight) > 0 ? longPx / Math.max(cssWidth, cssHeight) : 1;
  const cap = maxEdge / Math.max(pageWidth, pageHeight);
  return Math.min(base, cap);
}
