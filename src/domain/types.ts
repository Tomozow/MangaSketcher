export type PageId = string;
export type ClipId = string;
export type TextId = string;
export type ProjectId = string;

export type ToolId = 'pen' | 'eraser' | 'text' | 'select';

export type PointerKind = 'finger' | 'pencil';

export type PointerPhase = 'down' | 'move' | 'up' | 'longpress';

export type Rgba = { r: number; g: number; b: number; a: number };

export type Rect = { x: number; y: number; width: number; height: number };

export type Raster = {
  width: number;
  height: number;
  /** RGBA bytes, length width * height * 4 */
  data: Uint8ClampedArray;
};

export type PageText = {
  id: TextId;
  content: string;
  /** Page-local coordinates. Vertical writing; no rotation. */
  box: Rect;
  fontSize: number;
  color: string;
};

export type PasteboardText = {
  id: TextId;
  content: string;
  /** Workspace coordinates. */
  box: Rect;
  fontSize: number;
  color: string;
};

export type Page = {
  id: PageId;
  raster: Raster;
  texts: PageText[];
};

export type InkClip = {
  id: ClipId;
  raster: Raster;
  /** Workspace coordinates of the clip origin. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type StockItem = {
  pageId: PageId;
  x: number;
  y: number;
};

export type StockLayout = 'free' | 'grid';

export type ToolProperties = {
  penColor: string;
  /** Base size; actual stamp radius = size * pressure for pencil. */
  penSize: number;
  penOpacity: number;
  eraserSize: number;
  eraserOpacity: number;
  textColor: string;
  textFontSize: number;
};

export type PdfDocument = {
  uri: string;
  pageCount: number;
  currentPage: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Raw extracted items kept so source PDF text is never mutated. */
  sourceTextByPage: Record<number, PdfTextItem[]>;
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
  pdfViewerVisible: boolean;
  sidebarCompact: boolean;
  stockLayout: StockLayout;
};

export type HistoryState = {
  present: DocumentState;
  past: DocumentState[];
  future: DocumentState[];
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

export const TEMPLATE_PAGE_NUMBER_COVER: Rect = {
  x: 0.42,
  y: 0.93,
  width: 0.16,
  height: 0.055,
};

export const DEFAULT_RASTER_WIDTH = 48;
export const DEFAULT_RASTER_HEIGHT = 68;

export const DEFAULT_TOOL_PROPERTIES: ToolProperties = {
  penColor: '#1A1A1A',
  penSize: 2,
  penOpacity: 1,
  eraserSize: 4,
  eraserOpacity: 1,
  textColor: '#1A1A1A',
  textFontSize: 14,
};
