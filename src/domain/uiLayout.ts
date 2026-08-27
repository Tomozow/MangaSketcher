import type { StockLayout } from './types';

export const SPLIT_MIN = 0.22;
export const SPLIT_MAX = 0.78;
export const DEFAULT_WORKSPACE_PDF_SPLIT = 0.58;
export const DEFAULT_PALETTE_STOCK_SPLIT = 0.46;

export type UiLayout = {
  workspacePdfSplit: number;
  paletteStockSplit: number;
  pdfViewerVisible: boolean;
  sidebarCompact: boolean;
  stockLayout: StockLayout;
};

export const DEFAULT_UI_LAYOUT: UiLayout = {
  workspacePdfSplit: DEFAULT_WORKSPACE_PDF_SPLIT,
  paletteStockSplit: DEFAULT_PALETTE_STOCK_SPLIT,
  pdfViewerVisible: true,
  sidebarCompact: false,
  stockLayout: 'free',
};

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_WORKSPACE_PDF_SPLIT;
  }
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
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
  return {
    workspacePdfSplit: clampSplit(partial?.workspacePdfSplit ?? DEFAULT_WORKSPACE_PDF_SPLIT),
    paletteStockSplit: clampSplit(partial?.paletteStockSplit ?? DEFAULT_PALETTE_STOCK_SPLIT),
    pdfViewerVisible: partial?.pdfViewerVisible !== false,
    sidebarCompact: Boolean(partial?.sidebarCompact),
    stockLayout,
  };
}
