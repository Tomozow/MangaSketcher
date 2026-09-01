/** At least 2× CSS pixels so ink matches a high-res template on 1× desktop displays. */
const MIN_CSS_PIXEL_RATIO = 2;

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
