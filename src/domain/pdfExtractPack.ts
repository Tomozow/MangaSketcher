import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from './stripGeometry';
import type { Rect } from './types';

export const EXTRACT_TEXT_HEIGHT = PAGE_DISPLAY_H;
export const EXTRACT_GAP = 8;
export const EXTRACT_MARGIN_CSS = 16;

/** Map text-tool font (page raster px) to workspace CSS, matching on-page rendering. */
export function workspaceFontSizeFromTool(toolFontSize: number, rasterWidth: number): number {
  return Math.max(1, toolFontSize * (PAGE_DISPLAY_W / Math.max(1, rasterWidth)));
}

export type ExtractPackCursor = {
  originRight: number;
  originTop: number;
  rowLeftLimit: number;
  rowTop: number;
  lastBox: Rect;
};

export type ViewportWorld = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  zoom: number;
};

/** Vertical-rl: fixed column height, width grows by column count. */
export function extractedTextBoxSize(
  content: string,
  fontSize: number,
  height = EXTRACT_TEXT_HEIGHT,
): { width: number; height: number } {
  const size = Math.max(1, fontSize);
  const charsPerCol = Math.max(1, Math.floor(height / size));
  const chars = [...content.replace(/\s+/g, '')].length;
  const columns = Math.max(1, Math.ceil(Math.max(1, chars) / charsPerCol));
  return { width: columns * size, height };
}

export function startExtractPack(
  viewport: ViewportWorld,
  size: { width: number; height: number },
): { box: Rect; cursor: ExtractPackCursor } {
  const margin = EXTRACT_MARGIN_CSS / Math.max(0.01, viewport.zoom);
  const originRight = viewport.right - margin;
  const originTop = viewport.top + margin;
  const rowLeftLimit = viewport.left + margin;
  const box: Rect = {
    x: originRight - size.width,
    y: originTop,
    width: size.width,
    height: size.height,
  };
  return {
    box,
    cursor: {
      originRight,
      originTop,
      rowLeftLimit,
      rowTop: originTop,
      lastBox: { ...box },
    },
  };
}

export function nextExtractPack(
  cursor: ExtractPackCursor,
  size: { width: number; height: number },
): { box: Rect; cursor: ExtractPackCursor } {
  const candidateX = cursor.lastBox.x - EXTRACT_GAP - size.width;
  let rowTop = cursor.rowTop;
  let box: Rect;
  if (candidateX < cursor.rowLeftLimit) {
    rowTop = cursor.rowTop + EXTRACT_TEXT_HEIGHT + EXTRACT_GAP;
    box = {
      x: cursor.originRight - size.width,
      y: rowTop,
      width: size.width,
      height: size.height,
    };
  } else {
    box = {
      x: candidateX,
      y: rowTop,
      width: size.width,
      height: size.height,
    };
  }
  return {
    box,
    cursor: {
      ...cursor,
      rowTop,
      lastBox: { ...box },
    },
  };
}
