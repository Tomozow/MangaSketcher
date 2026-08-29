import { readingSpreads, type SpreadPair, type VisualSlot } from './layout';
import type { PageId } from './types';

export const PAGE_DISPLAY_W = 216;
export const PAGE_DISPLAY_H = 306;
/** Selected-text chrome button size as a fraction of page display width (follows workspace zoom). */
export const TEXT_CHROME_BUTTON_PAGE_RATIO = 15 / PAGE_DISPLAY_W;
export const TEXT_CHROME_GAP_PX = 6;
export const TEXT_CHROME_STACK_PX =
  PAGE_DISPLAY_W * TEXT_CHROME_BUTTON_PAGE_RATIO + TEXT_CHROME_GAP_PX;

/** Screen-pixel chrome sizes from the on-screen page width (follows zoom, not devicePixelRatio). */
export function textChromeScreenMetrics(pageWidthCss: number): { button: number; gap: number; stack: number } {
  const width = Number.isFinite(pageWidthCss) && pageWidthCss > 0 ? pageWidthCss : PAGE_DISPLAY_W;
  const button = width * TEXT_CHROME_BUTTON_PAGE_RATIO;
  const gap = width * (TEXT_CHROME_GAP_PX / PAGE_DISPLAY_W);
  return { button, gap, stack: button + gap };
}
export const APPEND_W = 56;
export const STRIP_GAP = 8;
export const SPREAD_GAP = 16;
/** Pages inside one spread sit this far apart (not user-controlled). */
export const SPREAD_INNER_GAP = 0;
/** Default gap between adjacent spreads (user-adjustable as pairGap). */
export const PAIR_GAP = 4;
export const MAX_PAIR_GAP = PAGE_DISPLAY_W;
export const MAX_COLUMN_GAP = PAGE_DISPLAY_H * 2;
export const PAGE_NUMBER_BAND = 44;
/** @deprecated Use PAGE_NUMBER_BAND — kept for imports that expect NUMBER_BAND. */
export const NUMBER_BAND = PAGE_NUMBER_BAND;

export type StripFrame = {
  key: string;
  slot: VisualSlot;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Reading-order insert index if a page is dropped on this frame. */
  insertIndex: number;
};

export type StripLayoutOptions = {
  pagesPerColumn?: number;
  pairGap?: number;
  showPairDivider?: boolean;
  columnGap?: number;
};

export type StripDivider = {
  key: string;
  x: number;
  y: number;
  height: number;
};

export function oddFloor(value: number): number {
  const n = Math.max(1, Math.round(value));
  return n % 2 === 1 ? n : n - 1;
}

export function oddCeil(value: number): number {
  const n = Math.max(1, Math.round(value));
  return n % 2 === 1 ? n : n + 1;
}

/** Slider max: odd so every page can sit in one row (even counts round up). */
export function maxPagesPerColumn(pageCount: number): number {
  return oddCeil(Math.max(1, pageCount));
}

/** Persist 0 (all in one row) or an odd count >= 1. */
export function clampStoredPagesPerColumn(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return oddFloor(value);
}

export function resolvePagesPerColumn(value: number | undefined, pageCount: number): number {
  const max = maxPagesPerColumn(pageCount);
  const stored = clampStoredPagesPerColumn(value);
  if (stored === 0) {
    return max;
  }
  return Math.min(max, stored);
}

export function clampPairGap(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return PAIR_GAP;
  }
  return Math.min(MAX_PAIR_GAP, Math.max(0, value));
}

export function clampColumnGap(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(MAX_COLUMN_GAP, Math.max(0, value));
}

export function stripLayoutFromDoc(doc: StripLayoutOptions): StripLayoutOptions {
  return {
    pagesPerColumn: clampStoredPagesPerColumn(doc.pagesPerColumn),
    pairGap: clampPairGap(doc.pairGap),
    showPairDivider: Boolean(doc.showPairDivider),
    columnGap: clampColumnGap(doc.columnGap),
  };
}

/**
 * Slider “1列のページ数” is real pages on the first row (blank does not count).
 * That maps to whole spreads: 1 page → spread 0 only, 3 pages → spreads 0–1, 5 → 0–2.
 */
export function spreadsPerColumn(pagesPerColumn: number): number {
  return Math.max(1, Math.ceil(Math.max(1, pagesPerColumn) / 2));
}

function packSpreadRows(reading: SpreadPair[], pagesPerColumn: number): SpreadPair[][] {
  const perRow = spreadsPerColumn(pagesPerColumn);
  const rows: SpreadPair[][] = [];
  for (let i = 0; i < reading.length; i += perRow) {
    rows.push(reading.slice(i, i + perRow).reverse());
  }
  return rows.length > 0 ? rows : [[]];
}

export function insertIndexForSlot(slot: VisualSlot, workspaceOrder: PageId[]): number {
  if (slot.kind === 'page') {
    return Math.max(0, workspaceOrder.indexOf(slot.pageId));
  }
  if (slot.kind === 'blank') {
    return slot.at === 'end' ? workspaceOrder.length : 0;
  }
  return workspaceOrder.length;
}

export function buildStripFrames(
  workspaceOrder: PageId[],
  options: StripLayoutOptions = {},
): {
  frames: StripFrame[];
  dividers: StripDivider[];
  contentWidth: number;
  contentHeight: number;
} {
  const stored = clampStoredPagesPerColumn(options.pagesPerColumn);
  const pagesPerColumn =
    stored === 0 ? Math.max(1, workspaceOrder.length) : resolvePagesPerColumn(options.pagesPerColumn, workspaceOrder.length);
  const pairGap = clampPairGap(options.pairGap);
  const columnGap = clampColumnGap(options.columnGap);
  const rowStride = PAGE_DISPLAY_H + PAGE_NUMBER_BAND + columnGap;
  const rows = packSpreadRows(readingSpreads(workspaceOrder), pagesPerColumn);
  const pageOriginX = APPEND_W + STRIP_GAP;

  type RowLayout = { frames: StripFrame[]; dividers: StripDivider[]; width: number };
  const rowLayouts: RowLayout[] = rows.map((row, rowIndex) => {
    const y = rowIndex * rowStride;
    const rowFrames: StripFrame[] = [];
    const rowDividers: StripDivider[] = [];
    let x = 0;
    row.forEach((pair, spreadIndex) => {
      pair.forEach((slot, i) => {
        rowFrames.push({
          key: `r${rowIndex}-s${spreadIndex}-${i}-${
            slot.kind === 'page' ? slot.pageId : `${slot.kind}-${slot.kind === 'blank' ? slot.at ?? 'start' : ''}`
          }`,
          slot,
          x,
          y,
          width: PAGE_DISPLAY_W,
          height: PAGE_DISPLAY_H,
          insertIndex: insertIndexForSlot(slot, workspaceOrder),
        });
        const lastInSpread = i === pair.length - 1;
        const lastSpread = spreadIndex === row.length - 1;
        if (!lastInSpread) {
          x += PAGE_DISPLAY_W + SPREAD_INNER_GAP;
          return;
        }
        if (!lastSpread) {
          if (options.showPairDivider) {
            rowDividers.push({
              key: `d-${rowIndex}-${spreadIndex}`,
              x: x + PAGE_DISPLAY_W + pairGap / 2,
              y,
              height: PAGE_DISPLAY_H,
            });
          }
          x += PAGE_DISPLAY_W + pairGap;
        } else {
          x += PAGE_DISPLAY_W;
        }
      });
    });
    return { frames: rowFrames, dividers: rowDividers, width: x };
  });

  const maxRowWidth = Math.max(0, ...rowLayouts.map((row) => row.width));
  const frames: StripFrame[] = [];
  const dividers: StripDivider[] = [];
  rowLayouts.forEach((row) => {
    const shift = pageOriginX + (maxRowWidth - row.width);
    row.frames.forEach((frame) => {
      frames.push({ ...frame, x: frame.x + shift });
    });
    row.dividers.forEach((divider) => {
      dividers.push({ ...divider, x: divider.x + shift });
    });
  });

  const rowCount = Math.max(1, rowLayouts.length);
  const lastRow = rowLayouts[rowCount - 1];
  const lastRowLeft = lastRow ? pageOriginX + (maxRowWidth - lastRow.width) : pageOriginX;
  frames.push({
    key: 'append',
    slot: { kind: 'append' },
    x: lastRowLeft - STRIP_GAP - APPEND_W,
    y: (rowCount - 1) * rowStride,
    width: APPEND_W,
    height: PAGE_DISPLAY_H,
    insertIndex: workspaceOrder.length,
  });

  return {
    frames,
    dividers,
    contentWidth: pageOriginX + maxRowWidth + 24,
    contentHeight: (rowCount - 1) * rowStride + PAGE_DISPLAY_H + PAGE_NUMBER_BAND,
  };
}

export function hitStripFrame(frames: StripFrame[], worldX: number, worldY: number): StripFrame | null {
  for (const frame of frames) {
    if (
      worldX >= frame.x &&
      worldX <= frame.x + frame.width &&
      worldY >= frame.y &&
      worldY < frame.y + frame.height
    ) {
      return frame;
    }
  }
  for (const frame of frames) {
    if (frame.slot.kind !== 'page') {
      continue;
    }
    if (
      worldX >= frame.x &&
      worldX <= frame.x + frame.width &&
      worldY >= frame.y + frame.height &&
      worldY < frame.y + frame.height + PAGE_NUMBER_BAND
    ) {
      return frame;
    }
  }
  const inAnyNumberBand = frames.some(
    (frame) =>
      frame.slot.kind === 'page' &&
      worldY >= frame.y + frame.height &&
      worldY < frame.y + frame.height + PAGE_NUMBER_BAND,
  );
  let nearest: StripFrame | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    if (inAnyNumberBand && frame.slot.kind !== 'page') {
      continue;
    }
    const cx = frame.x + frame.width / 2;
    const cy =
      inAnyNumberBand && frame.slot.kind === 'page'
        ? frame.y + frame.height + PAGE_NUMBER_BAND / 2
        : frame.y + frame.height / 2;
    const dx = worldX - cx;
    const dy = worldY - cy;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      nearest = frame;
    }
  }
  return nearest;
}

export function pageLocalFromWorld(
  frame: StripFrame,
  worldX: number,
  worldY: number,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } {
  return {
    x: ((worldX - frame.x) / frame.width) * rasterWidth,
    y: ((worldY - frame.y) / frame.height) * rasterHeight,
  };
}

/** Page ink rectangle only (no number band, no nearest-frame fallback). */
export function pageInkFrameAtWorld(frames: StripFrame[], worldX: number, worldY: number): StripFrame | null {
  for (const frame of frames) {
    if (frame.slot.kind !== 'page') {
      continue;
    }
    if (
      worldX >= frame.x &&
      worldX <= frame.x + frame.width &&
      worldY >= frame.y &&
      worldY < frame.y + frame.height
    ) {
      return frame;
    }
  }
  return null;
}

export function clampRasterPoint(
  x: number,
  y: number,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } {
  return {
    x: Math.min(rasterWidth, Math.max(0, x)),
    y: Math.min(rasterHeight, Math.max(0, y)),
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  panX: number,
  panY: number,
  zoom: number,
): { x: number; y: number } {
  return { x: (screenX - panX) / zoom, y: (screenY - panY) / zoom };
}
