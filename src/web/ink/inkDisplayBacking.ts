/** At least 2× CSS pixels so ink matches a high-res template on 1× desktop displays. */
const MIN_CSS_PIXEL_RATIO = 2;

/**
 * Pinch / drag-zoom already CSS-scales the strip. Wait until live zoom is idle
 * before reallocating the display backing (canvas.width wipe + full blit).
 */
export const INK_BACKING_ZOOM_SETTLE_MS = 180;

/** Keep `committedZoom` until `liveZoom` has been unchanged for `settleMs`. */
export function nextSettledCssZoom(
  liveZoom: number,
  committedZoom: number,
  msSinceLiveZoomChanged: number,
  settleMs: number = INK_BACKING_ZOOM_SETTLE_MS,
): number {
  const live = Number.isFinite(liveZoom) && liveZoom > 0 ? liveZoom : 1;
  const committed = Number.isFinite(committedZoom) && committedZoom > 0 ? committedZoom : 1;
  if (live === committed) {
    return committed;
  }
  if (msSinceLiveZoomChanged >= settleMs) {
    return live;
  }
  return committed;
}

export function inkDisplayBackingScale(devicePixelRatio: number, cssZoom: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const zoom = Number.isFinite(cssZoom) && cssZoom > 0 ? cssZoom : 1;
  return Math.max(dpr, MIN_CSS_PIXEL_RATIO) * zoom;
}

export function inkDisplayBackingSize(input: {
  displayWidth: number;
  displayHeight?: number;
  rasterWidth: number;
  rasterHeight: number;
  devicePixelRatio: number;
  cssZoom: number;
}): { cssHeight: number; pixelW: number; pixelH: number } {
  const displayWidth = Math.max(1, input.displayWidth);
  const rasterWidth = Math.max(1, input.rasterWidth);
  const rasterHeight = Math.max(1, input.rasterHeight);
  const cssHeight = Math.max(
    1,
    input.displayHeight != null
      ? input.displayHeight
      : Math.round((displayWidth * rasterHeight) / rasterWidth),
  );
  const scale = inkDisplayBackingScale(input.devicePixelRatio, input.cssZoom);
  return {
    cssHeight,
    pixelW: Math.max(1, Math.min(rasterWidth, Math.round(displayWidth * scale))),
    pixelH: Math.max(1, Math.min(rasterHeight, Math.round(cssHeight * scale))),
  };
}
