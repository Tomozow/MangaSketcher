import type { EditorDocument, ProjectId, ToolProperties } from '../domain/types';

export type {
  ClipId,
  ClipMeta,
  EditorDocument,
  PageId,
  PageMeta,
  PageText,
  PasteboardText,
  PdfDocument,
  ProjectId,
  StockItem,
  StockLayout,
  StockPaneMode,
  TextId,
  ToolId,
  ToolProperties,
} from '../domain/types';

/** Spec alias — same shape as domain `PdfDocument`. */
export type PdfMeta = import('../domain/types').PdfDocument;

export const DB_NAME = 'mangasketcher';
export const DB_VERSION = 1;
/** Reserved `meta` row for app UI settings (excluded from project lists). */
export const APP_SETTINGS_META_ID = 'mangasketcher:app-settings';

export const DEFAULT_RASTER_WIDTH = 1200;
export const DEFAULT_RASTER_HEIGHT = 1700;

export const DOCUMENT_SAVE_DEBOUNCE_MS = 800;
export const VIEW_ONLY_SAVE_DEBOUNCE_MS = 1500;
/** Idle after the last ink stroke before encode + IndexedDB write. */
export const INK_IDLE_AUTOSAVE_MS = 1000;
export const HISTORY_DEPTH = 50;

export const OPFS_PDF_DIR = 'pdfs';

export type ProjectMeta = {
  id: ProjectId;
  name: string;
  updatedAt: string;
  pageCount: number;
};

export type InkUndoPixels = ArrayBuffer | OffscreenCanvas;

export type EditorHistoryEntry = {
  doc: EditorDocument;
  inkUndo: Map<string, InkUndoPixels>;
};

export type EditorHistory = {
  present: EditorDocument;
  past: EditorHistoryEntry[];
  future: EditorHistoryEntry[];
};

export const DEFAULT_TOOL_PROPERTIES: ToolProperties = {
  penColor: '#1A1A1A',
  penSize: 12,
  penOpacity: 1,
  eraserSize: 28,
  eraserOpacity: 1,
  textColor: '#1A1A1A',
  textFontSize: 36,
  pressureEnabled: true,
  selectText: true,
  selectInk: true,
  selectClip: true,
};

export { DEFAULT_UI_LAYOUT } from '../domain/uiLayout';
