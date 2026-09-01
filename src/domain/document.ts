import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  DEFAULT_TOOL_PROPERTIES,
  type DocumentState,
  type EditorDocument,
  type Page,
  type PageId,
  type PageMeta,
  type PdfDocument,
} from './types';
import { cloneRaster, createRaster } from './raster';
import { DEFAULT_UI_LAYOUT, normalizeUiLayout } from './uiLayout';
import { cloneStockItem, cloneTrashClipAttachedTexts } from './stockItems';

export type IdFactory = () => string;

export function sequentialIds(prefix: string): IdFactory {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}_${n}`;
  };
}

function makePage(id: PageId, width: number, height: number): Page {
  return {
    id,
    raster: createRaster(width, height),
    texts: [],
  };
}

export function createDocument(options: {
  projectId: string;
  name: string;
  pageCount: number;
  rasterWidth?: number;
  rasterHeight?: number;
  ids?: IdFactory;
}): DocumentState {
  if (options.pageCount < 1) {
    throw new Error('pageCount must be >= 1');
  }
  const ids = options.ids ?? sequentialIds('id');
  const rasterWidth = options.rasterWidth ?? DEFAULT_RASTER_WIDTH;
  const rasterHeight = options.rasterHeight ?? DEFAULT_RASTER_HEIGHT;
  const pages: DocumentState['pages'] = {};
  const workspaceOrder: PageId[] = [];
  for (let i = 0; i < options.pageCount; i += 1) {
    const id = ids();
    pages[id] = makePage(id, rasterWidth, rasterHeight);
    workspaceOrder.push(id);
  }
  return {
    projectId: options.projectId,
    name: options.name,
    rasterWidth,
    rasterHeight,
    pages,
    workspaceOrder,
    stock: [],
    trash: [],
    trashClips: [],
    trashTexts: [],
    pasteboardClips: [],
    pasteboardTexts: [],
    selectedPageId: workspaceOrder[0] ?? null,
    selectedClipId: null,
    selectedTextId: null,
    tool: 'pen',
    tools: { ...DEFAULT_TOOL_PROPERTIES },
    pdf: null,
    workspaceZoom: 1,
    workspacePanX: 0,
    workspacePanY: 0,
    stockZoom: 1,
    stockPanX: 0,
    stockPanY: 0,
    ...DEFAULT_UI_LAYOUT,
  };
}

export function clonePdfDocument(pdf: PdfDocument): PdfDocument {
  const next = { ...pdf } as PdfDocument & {
    extractedGlyphs?: unknown;
    extractMarkersVisible?: unknown;
  };
  delete next.extractedGlyphs;
  delete next.extractMarkersVisible;
  return {
    ...next,
    sourceTextByPage: Object.fromEntries(
      Object.entries(next.sourceTextByPage).map(([k, v]) => [k, v.map((i) => ({ ...i }))]),
    ),
    extractSanitizePunctuation: next.extractSanitizePunctuation === true,
  };
}

export function cloneDocument(doc: DocumentState): DocumentState {
  const pages: DocumentState['pages'] = {};
  for (const [id, page] of Object.entries(doc.pages)) {
    pages[id] = {
      id: page.id,
      raster: cloneRaster(page.raster),
      texts: page.texts.map((t) => ({ ...t, box: { ...t.box } })),
    };
  }
  return {
    ...doc,
    pages,
    workspaceOrder: [...doc.workspaceOrder],
    stock: doc.stock.map((s) => cloneStockItem(s)),
    trash: [...(doc.trash ?? [])],
    trashClips: [...(doc.trashClips ?? [])],
    trashTexts: [...(doc.trashTexts ?? [])],
    trashClipAttachedTexts: cloneTrashClipAttachedTexts(doc.trashClipAttachedTexts),
    pasteboardClips: doc.pasteboardClips.map((c) => ({
      ...c,
      raster: cloneRaster(c.raster),
    })),
    pasteboardTexts: doc.pasteboardTexts.map((t) => ({ ...t, box: { ...t.box } })),
    tools: { ...doc.tools },
    ...normalizeUiLayout(doc),
    pdf: doc.pdf ? clonePdfDocument(doc.pdf) : null,
  };
}

export function newPage(doc: DocumentState, ids: IdFactory): Page {
  return makePage(ids(), doc.rasterWidth, doc.rasterHeight);
}

function makePageMeta(projectId: string, id: PageId): PageMeta {
  return {
    id,
    rasterId: `${projectId}:page:${id}`,
    texts: [],
  };
}

export function createEditorDocument(options: {
  projectId: string;
  name: string;
  pageCount: number;
  rasterWidth?: number;
  rasterHeight?: number;
  ids?: IdFactory;
}): EditorDocument {
  if (options.pageCount < 1) {
    throw new Error('pageCount must be >= 1');
  }
  const ids = options.ids ?? sequentialIds('id');
  const rasterWidth = options.rasterWidth ?? DEFAULT_RASTER_WIDTH;
  const rasterHeight = options.rasterHeight ?? DEFAULT_RASTER_HEIGHT;
  const pages: EditorDocument['pages'] = {};
  const workspaceOrder: PageId[] = [];
  for (let i = 0; i < options.pageCount; i += 1) {
    const id = ids();
    pages[id] = makePageMeta(options.projectId, id);
    workspaceOrder.push(id);
  }
  return {
    projectId: options.projectId,
    name: options.name,
    rasterWidth,
    rasterHeight,
    pages,
    workspaceOrder,
    stock: [],
    trash: [],
    trashClips: [],
    trashTexts: [],
    pasteboardClips: [],
    pasteboardTexts: [],
    selectedPageId: workspaceOrder[0] ?? null,
    selectedClipId: null,
    selectedClipIds: [],
    selectedTextId: null,
    selectedTextIds: [],
    tool: 'pen',
    tools: { ...DEFAULT_TOOL_PROPERTIES },
    pdf: null,
    workspaceZoom: 1,
    workspacePanX: 0,
    workspacePanY: 0,
    stockZoom: 1,
    stockPanX: 0,
    stockPanY: 0,
    ...DEFAULT_UI_LAYOUT,
    inkGeneration: 0,
  };
}

export function cloneEditorDocument(doc: EditorDocument): EditorDocument {
  const pages: EditorDocument['pages'] = {};
  for (const [id, page] of Object.entries(doc.pages)) {
    pages[id] = {
      id: page.id,
      rasterId: page.rasterId,
      texts: page.texts.map((t) => ({ ...t, box: { ...t.box } })),
    };
  }
  return {
    ...doc,
    pages,
    workspaceOrder: [...doc.workspaceOrder],
    stock: doc.stock.map((s) => cloneStockItem(s)),
    trash: [...(doc.trash ?? [])],
    trashClips: [...(doc.trashClips ?? [])],
    trashTexts: [...(doc.trashTexts ?? [])],
    trashClipAttachedTexts: cloneTrashClipAttachedTexts(doc.trashClipAttachedTexts),
    pasteboardClips: doc.pasteboardClips.map((c) => ({ ...c })),
    pasteboardTexts: doc.pasteboardTexts.map((t) => ({ ...t, box: { ...t.box } })),
    selectedClipIds: [...(doc.selectedClipIds ?? (doc.selectedClipId ? [doc.selectedClipId] : []))],
    selectedTextIds: [...(doc.selectedTextIds ?? (doc.selectedTextId ? [doc.selectedTextId] : []))],
    tools: { ...doc.tools },
    ...normalizeUiLayout(doc),
    pdf: doc.pdf ? clonePdfDocument(doc.pdf) : null,
  };
}

export function newPageMeta(doc: EditorDocument, ids: IdFactory): PageMeta {
  const id = ids();
  return makePageMeta(doc.projectId, id);
}
