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

/** iOS Safari canvas pixel budget (width * height). */
export const IOS_MAX_CANVAS_AREA = 16_777_216;

/** Cached bitmap is sharp enough when it is within 2% of the needed pdf.js scale. */
export const PDF_SCALE_REUSE_RATIO = 0.98;

/**
 * pdf.js viewport scale: match on-screen CSS (letterbox × zoom × dpr),
 * then cap bitmap long edge and total pixels so iPad does not blank the canvas.
 */
export function renderScaleForPage(
  pageWidth: number,
  pageHeight: number,
  cssWidth: number,
  cssHeight: number,
  zoom: number,
  dpr: number,
  maxEdge: number,
): number {
  const pw = Math.max(1, pageWidth);
  const ph = Math.max(1, pageHeight);
  const cssW = Math.max(1, cssWidth);
  const cssH = Math.max(1, cssHeight);
  const contain = Math.min(cssW / pw, cssH / ph);
  const desired = contain * Math.max(0.01, zoom) * Math.max(1, dpr);
  const edgeCap = maxEdge / Math.max(pw, ph);
  let scale = Math.min(desired, edgeCap);
  const area = pw * scale * (ph * scale);
  if (area > IOS_MAX_CANVAS_AREA) {
    scale *= Math.sqrt(IOS_MAX_CANVAS_AREA / area);
  }
  return scale;
}

export function bitmapCoversNeededScale(cachedScale: number, neededScale: number): boolean {
  return cachedScale >= neededScale * PDF_SCALE_REUSE_RATIO;
}

export type PdfPaintPlan = {
  previewScale: number;
  sharpScale: number;
  /** True when the sharp pass would actually add pixels (high zoom / DPR). */
  runSharpPass: boolean;
};

export function planPdfPaint(
  pageWidth: number,
  pageHeight: number,
  cssWidth: number,
  cssHeight: number,
  zoom: number,
  dpr: number,
  previewMaxEdge: number,
  sharpMaxEdge: number,
): PdfPaintPlan {
  const previewScale = renderScaleForPage(
    pageWidth,
    pageHeight,
    cssWidth,
    cssHeight,
    zoom,
    dpr,
    previewMaxEdge,
  );
  const sharpScale = renderScaleForPage(
    pageWidth,
    pageHeight,
    cssWidth,
    cssHeight,
    zoom,
    dpr,
    sharpMaxEdge,
  );
  return {
    previewScale,
    sharpScale,
    runSharpPass: !bitmapCoversNeededScale(previewScale, sharpScale),
  };
}

export type PdfPaintImmediate = 'blit' | 'render-preview';

export type PdfPaintDecision = {
  immediate: PdfPaintImmediate;
  /** Queue the 8192-capped pass after idle; skip when cache already covers it. */
  needSharp: boolean;
};

export function decidePdfPaint(
  plan: PdfPaintPlan,
  cachedScale: number | null,
): PdfPaintDecision {
  if (cachedScale != null && bitmapCoversNeededScale(cachedScale, plan.sharpScale)) {
    return { immediate: 'blit', needSharp: false };
  }
  if (cachedScale != null && bitmapCoversNeededScale(cachedScale, plan.previewScale)) {
    return { immediate: 'blit', needSharp: plan.runSharpPass };
  }
  return { immediate: 'render-preview', needSharp: plan.runSharpPass };
}
