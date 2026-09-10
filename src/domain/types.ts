export type PageId = string;
export type ClipId = string;
export type TextId = string;
export type ProjectId = string;

export type ToolId = 'pen' | 'eraser' | 'text' | 'select' | 'lasso' | 'scissors';

export function isSelectionTool(tool: ToolId): tool is 'select' | 'lasso' {
  return tool === 'select' || tool === 'lasso';
}

export type PointerKind = 'finger' | 'pencil';

export type PointerPhase = 'down' | 'move' | 'up' | 'longpress';

export type Rgba = { r: number; g: number; b: number; a: number };

export type Rect = { x: number; y: number; width: number; height: number };

export type WritingMode = 'vertical' | 'horizontal';

export function writingModeOf(mode?: WritingMode | null): WritingMode {
  return mode === 'horizontal' ? 'horizontal' : 'vertical';
}

export type Raster = {
  width: number;
  height: number;
  /** RGBA bytes, length width * height * 4 */
  data: Uint8ClampedArray;
};

export type PageText = {
  id: TextId;
  content: string;
  /** Page-local coordinates. No rotation. */
  box: Rect;
  fontSize: number;
  color: string;
  /** Omitted on legacy documents = vertical. */
  writingMode?: WritingMode;
};

export type PasteboardText = {
  id: TextId;
  content: string;
  /** Workspace coordinates. */
  box: Rect;
  fontSize: number;
  color: string;
  writingMode?: WritingMode;
};

export type Page = {
  id: PageId;
  raster: Raster;
  texts: PageText[];
};

/** Production page metadata — pixels live in InkEngine, not here. */
export type PageMeta = {
  id: PageId;
  texts: PageText[];
  rasterId: string;
};

/** Text lookup shape shared by EditorDocument and TestDocument. */
export type TextDocument = {
  pages: Record<PageId, { id: PageId; texts: PageText[] }>;
  pasteboardTexts: PasteboardText[];
};

export type InkClip = {
  id: ClipId;
  raster: Raster;
  /** Workspace coordinates of the clip origin. */
  x: number;
  y: number;
  scale: number;
  /** Independent vertical scale; omitted means the same as `scale`. */
  scaleY?: number;
  rotation: number;
};

/** Production clip metadata — pixels live in InkEngine. */
export type ClipMeta = {
  id: ClipId;
  rasterId: string;
  x: number;
  y: number;
  scale: number;
  /** Independent vertical scale; omitted means the same as `scale`. */
  scaleY?: number;
  rotation: number;
};

/** Text bundled onto a stocked clip; offsets are workspace coords from the clip origin. */
export type StockAttachedText = {
  textId: TextId;
  offsetX: number;
  offsetY: number;
};

export type StockItem = {
  kind?: 'page' | 'clip' | 'text';
  pageId?: PageId;
  clipId?: ClipId;
  textId?: TextId;
  attachedTexts?: StockAttachedText[];
  x: number;
  y: number;
};

export type StockLayout = 'free' | 'grid';

export type StockPaneMode = 'stock' | 'trash';

export type SelectTargetFlags = {
  text: boolean;
  ink: boolean;
  clip: boolean;
};

export type ToolProperties = {
  penColor: string;
  /** Base size; actual stamp radius = size * pressure for pencil. */
  penSize: number;
  penOpacity: number;
  eraserSize: number;
  eraserOpacity: number;
  textColor: string;
  textFontSize: number;
  /** Default for new text boxes. Omitted = vertical. */
  textWritingMode?: WritingMode;
  /** When false, pen/eraser ignore stylus pressure (undefined treated as true). */
  pressureEnabled?: boolean;
  /** When set, overrides size pressure. Undefined follows `pressureEnabled`. */
  pressureAffectsSize?: boolean;
  /** When true, stylus pressure scales opacity. Undefined is false. */
  pressureAffectsOpacity?: boolean;
  eraserPressureAffectsSize?: boolean;
  eraserPressureAffectsOpacity?: boolean;
  /** Select-tool filters. Undefined is treated as true (legacy documents). */
  selectText?: boolean;
  selectInk?: boolean;
  selectClip?: boolean;
  /** Select-tool shape. Undefined is rectangle (legacy documents). */
  selectLasso?: boolean;
  /** Scissors-tool shape. Undefined is rectangle. Ctrl+drag also uses lasso. */
  scissorsLasso?: boolean;
  /** When true, switch to the select tool after a scissors cut. Undefined is false. */
  scissorsSwitchToSelect?: boolean;
  /** Scissors-tool filters. Undefined is treated as true. */
  scissorsSelectText?: boolean;
  scissorsSelectInk?: boolean;
  scissorsSelectClip?: boolean;
};

export function selectTargetFlagsOf(
  tools: Pick<ToolProperties, 'selectText' | 'selectInk' | 'selectClip'> | undefined,
): SelectTargetFlags {
  return {
    text: tools?.selectText !== false,
    ink: tools?.selectInk !== false,
    clip: tools?.selectClip !== false,
  };
}

export function scissorsTargetFlagsOf(
  tools: Pick<ToolProperties, 'scissorsSelectText' | 'scissorsSelectInk' | 'scissorsSelectClip'> | undefined,
): SelectTargetFlags {
  return {
    text: tools?.scissorsSelectText !== false,
    ink: tools?.scissorsSelectInk !== false,
    clip: tools?.scissorsSelectClip !== false,
  };
}

export function isLassoSelectMode(
  tool: ToolId,
  tools?: Pick<ToolProperties, 'selectLasso'>,
): boolean {
  return tool === 'lasso' || (tool === 'select' && tools?.selectLasso === true);
}

export type PdfDocument = {
  pageCount: number;
  currentPage: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Raw extracted items kept so source PDF text is never mutated. */
  sourceTextByPage: Record<number, PdfTextItem[]>;
  opfsPath: string;
  generation: number;
  /** File identity (name/size/mtime) so a re-pick of the same PDF can restore the page. */
  sourceFingerprint?: string;
  /** When extracting, drop 「」 and replace 、。 with ASCII spaces. */
  extractSanitizePunctuation?: boolean;
};

export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  /** Tagged role when known, e.g. Ruby. */
  role?: string;
};


export type DocumentState = {
  projectId: ProjectId;
  name: string;
  rasterWidth: number;
  rasterHeight: number;
  pages: Record<PageId, Page>;
  /** Reading order (page 1 first). */
  workspaceOrder: PageId[];
  stock: StockItem[];
  /** Soft-deleted pages; still present in `pages`. */
  trash: PageId[];
  /** Soft-deleted clips; still present in `pasteboardClips`. */
  trashClips: ClipId[];
  /** Soft-deleted texts; still present in `pasteboardTexts`. */
  trashTexts: TextId[];
  /** Clip→text offsets preserved while a bundled clip is in the trash. */
  trashClipAttachedTexts?: Record<ClipId, StockAttachedText[]>;
  pasteboardClips: InkClip[];
  pasteboardTexts: PasteboardText[];
  selectedPageId: PageId | null;
  selectedClipId: ClipId | null;
  selectedTextId: TextId | null;
  tool: ToolId;
  tools: ToolProperties;
  pdf: PdfDocument | null;
  workspaceZoom: number;
  workspacePanX: number;
  workspacePanY: number;
  stockZoom: number;
  stockPanX: number;
  stockPanY: number;
  workspacePdfSplit: number;
  paletteStockSplit: number;
  pdfDrawerWidth: number;
  pdfDrawerHeight: number;
  stockDrawerWidth: number;
  stockDrawerHeight: number;
  pdfViewerVisible: boolean;
  sidebarCompact: boolean;
  stockLayout: StockLayout;
  stockPane: StockPaneMode;
  /** Real pages per column (odd); 0 = all pages in one row. Slot 0 blank is not counted. */
  pagesPerColumn: number;
  /** World-space gap between adjacent spreads. */
  pairGap: number;
  showPairDivider: boolean;
  /** World-space vertical gap between columns/rows; max two page heights. */
  columnGap: number;
};

/** Production React state / IDB JSON — no Uint8ClampedArray. */
export type EditorDocument = {
  projectId: ProjectId;
  name: string;
  rasterWidth: number;
  rasterHeight: number;
  pages: Record<PageId, PageMeta>;
  workspaceOrder: PageId[];
  stock: StockItem[];
  trash: PageId[];
  trashClips: ClipId[];
  trashTexts: TextId[];
  trashClipAttachedTexts?: Record<ClipId, StockAttachedText[]>;
  pasteboardClips: ClipMeta[];
  pasteboardTexts: PasteboardText[];
  selectedPageId: PageId | null;
  selectedClipId: ClipId | null;
  /** All currently selected pasteboard clips; `selectedClipId` is the last / primary. */
  selectedClipIds?: ClipId[];
  selectedTextId: TextId | null;
  /** All currently selected texts; `selectedTextId` is the last / primary. */
  selectedTextIds?: TextId[];
  tool: ToolId;
  tools: ToolProperties;
  pdf: PdfDocument | null;
  workspaceZoom: number;
  workspacePanX: number;
  workspacePanY: number;
  stockZoom: number;
  stockPanX: number;
  stockPanY: number;
  workspacePdfSplit: number;
  paletteStockSplit: number;
  pdfDrawerWidth: number;
  pdfDrawerHeight: number;
  stockDrawerWidth: number;
  stockDrawerHeight: number;
  pdfViewerVisible: boolean;
  sidebarCompact: boolean;
  stockLayout: StockLayout;
  stockPane: StockPaneMode;
  pagesPerColumn: number;
  pairGap: number;
  showPairDivider: boolean;
  columnGap: number;
  inkGeneration: number;
};

export type HistoryState = {
  present: DocumentState;
  past: DocumentState[];
  future: DocumentState[];
};

export type EditorHistoryEntry = {
  doc: EditorDocument;
  inkUndo: Record<string, ArrayBuffer>;
};

export type EditorHistoryState = {
  present: EditorDocument;
  past: EditorHistoryEntry[];
  future: EditorHistoryEntry[];
};

export type ProjectMeta = {
  id: ProjectId;
  name: string;
  updatedAt: string;
  pageCount: number;
};

export type PointerEvent = {
  kind: PointerKind;
  phase: PointerPhase;
  x: number;
  y: number;
  pressure: number;
};

/** Normalized cover for the baked page-number “1”. Matches clip PAGE_NUMBER_PIXEL_RECT (760,1884)–(792,1932) on 1518×2150. */
export const TEMPLATE_PAGE_NUMBER_COVER: Rect = {
  x: 760 / 1518,
  y: 1884 / 2150,
  width: 32 / 1518,
  height: 48 / 2150,
};

export const DEFAULT_RASTER_WIDTH = 1200;
export const DEFAULT_RASTER_HEIGHT = 1700;

export const DEFAULT_TOOL_PROPERTIES: ToolProperties = {
  penColor: '#1A1A1A',
  penSize: 12,
  penOpacity: 1,
  eraserSize: 28,
  eraserOpacity: 1,
  textColor: '#1A1A1A',
  textFontSize: 36,
  textWritingMode: 'vertical',
  pressureEnabled: true,
  pressureAffectsSize: true,
  pressureAffectsOpacity: false,
  eraserPressureAffectsSize: true,
  eraserPressureAffectsOpacity: false,
  selectText: true,
  selectInk: true,
  selectClip: true,
};

/** In-memory test document with embedded raster bytes (Vitest only). */
export type TestDocument = DocumentState;
