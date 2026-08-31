import type { StockLayout, StockPaneMode } from './types';
import {
  clampColumnGap,
  clampPairGap,
  clampStoredPagesPerColumn,
  PAGE_DISPLAY_H,
} from './stripGeometry';

export const SPLIT_MIN = 0.22;
export const SPLIT_MAX = 0.78;
export const DEFAULT_WORKSPACE_PDF_SPLIT = 0.58;
export const DEFAULT_PALETTE_STOCK_SPLIT = 0.46;
export const PDF_DRAWER_WIDTH_MIN = 0.18;
export const PDF_DRAWER_WIDTH_MAX = 0.72;
export const PDF_DRAWER_HEIGHT_MIN = 0.28;
export const PDF_DRAWER_HEIGHT_MAX = 1;
export const DEFAULT_PDF_DRAWER_WIDTH = 0.32;
export const DEFAULT_PDF_DRAWER_HEIGHT = 1;
export const PDF_DRAWER_TOP_PX = 68;
export const PDF_DRAWER_BOTTOM_GAP_PX = 16;

export type UiLayout = {
  workspacePdfSplit: number;
  paletteStockSplit: number;
  pdfDrawerWidth: number;
  pdfDrawerHeight: number;
  pdfViewerVisible: boolean;
  sidebarCompact: boolean;
  stockLayout: StockLayout;
  stockPane: StockPaneMode;
  pagesPerColumn: number;
  pairGap: number;
  showPairDivider: boolean;
  columnGap: number;
};

export const DEFAULT_UI_LAYOUT: UiLayout = {
  workspacePdfSplit: DEFAULT_WORKSPACE_PDF_SPLIT,
  paletteStockSplit: DEFAULT_PALETTE_STOCK_SPLIT,
  pdfDrawerWidth: DEFAULT_PDF_DRAWER_WIDTH,
  pdfDrawerHeight: DEFAULT_PDF_DRAWER_HEIGHT,
  pdfViewerVisible: false,
  sidebarCompact: false,
  stockLayout: 'free',
  stockPane: 'stock',
  pagesPerColumn: 3,
  pairGap: 126,
  showPairDivider: true,
  columnGap: PAGE_DISPLAY_H,
};

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_WORKSPACE_PDF_SPLIT;
  }
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
}

export function clampPdfDrawerWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PDF_DRAWER_WIDTH;
  }
  return Math.min(PDF_DRAWER_WIDTH_MAX, Math.max(PDF_DRAWER_WIDTH_MIN, value));
}

export function clampPdfDrawerHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PDF_DRAWER_HEIGHT;
  }
  return Math.min(PDF_DRAWER_HEIGHT_MAX, Math.max(PDF_DRAWER_HEIGHT_MIN, value));
}

/** Left edge of a right-anchored drawer: pointer moving right shrinks width. */
export function nextPdfDrawerWidth(
  current: number,
  deltaLeftEdgePx: number,
  parentWidthPx: number,
): number {
  return clampPdfDrawerWidth(current - deltaLeftEdgePx / Math.max(1, parentWidthPx));
}

/** Bottom edge: pointer moving down grows height. */
export function nextPdfDrawerHeight(
  current: number,
  deltaBottomEdgePx: number,
  availableHeightPx: number,
): number {
  return clampPdfDrawerHeight(current + deltaBottomEdgePx / Math.max(1, availableHeightPx));
}

/** ハンドルを正方向へ動かしたとき、上側ペインの比率が増える。 */
export function nextSplitFromDrag(current: number, deltaPx: number, totalPx: number): number {
  const span = Math.max(1, totalPx);
  return clampSplit(current + deltaPx / span);
}

export function mainPaneFlex(layout: Pick<UiLayout, 'workspacePdfSplit' | 'pdfViewerVisible'>): {
  workspace: number;
  pdf: number;
} {
  if (!layout.pdfViewerVisible) {
    return { workspace: 1, pdf: 0 };
  }
  const split = clampSplit(layout.workspacePdfSplit);
  return { workspace: split, pdf: 1 - split };
}

export function sidebarPaneFlex(layout: Pick<UiLayout, 'paletteStockSplit'>): {
  palette: number;
  stock: number;
} {
  const split = clampSplit(layout.paletteStockSplit);
  return { palette: split, stock: 1 - split };
}

export function togglePdfViewer(layout: UiLayout, visible: boolean): UiLayout {
  return { ...layout, pdfViewerVisible: visible };
}

export function normalizeUiLayout(partial: Partial<UiLayout> | undefined): UiLayout {
  const stockLayout = partial?.stockLayout === 'grid' ? 'grid' : 'free';
  const stockPane = partial?.stockPane === 'trash' ? 'trash' : 'stock';
  return {
    workspacePdfSplit: clampSplit(partial?.workspacePdfSplit ?? DEFAULT_WORKSPACE_PDF_SPLIT),
    paletteStockSplit: clampSplit(partial?.paletteStockSplit ?? DEFAULT_PALETTE_STOCK_SPLIT),
    pdfDrawerWidth: clampPdfDrawerWidth(partial?.pdfDrawerWidth ?? DEFAULT_PDF_DRAWER_WIDTH),
    pdfDrawerHeight: clampPdfDrawerHeight(partial?.pdfDrawerHeight ?? DEFAULT_PDF_DRAWER_HEIGHT),
    pdfViewerVisible: partial?.pdfViewerVisible !== false,
    sidebarCompact: Boolean(partial?.sidebarCompact),
    stockLayout,
    stockPane,
    pagesPerColumn: clampStoredPagesPerColumn(partial?.pagesPerColumn),
    pairGap: clampPairGap(partial?.pairGap),
    showPairDivider: Boolean(partial?.showPairDivider),
    columnGap: clampColumnGap(partial?.columnGap),
  };
}
