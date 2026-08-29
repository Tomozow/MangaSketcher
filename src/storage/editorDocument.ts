import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  DEFAULT_TOOL_PROPERTIES,
  DEFAULT_UI_LAYOUT,
  type EditorDocument,
  type PageMeta,
  type ProjectId,
} from './types';
import { pageRasterId } from './rasterIds';
import { randomId } from './randomId';
import { clonePdfDocument } from '../domain/document';
import { normalizeUiLayout } from '../domain/uiLayout';

export type IdFactory = () => string;

export function createIdFactory(): IdFactory {
  return () => randomId();
}

export function createEditorDocument(options: {
  projectId?: ProjectId;
  name: string;
  pageCount: number;
  rasterWidth?: number;
  rasterHeight?: number;
  ids?: IdFactory;
}): EditorDocument {
  if (options.pageCount < 1) {
    throw new Error('pageCount must be >= 1');
  }
  const ids = options.ids ?? createIdFactory();
  const projectId = options.projectId ?? ids();
  const rasterWidth = options.rasterWidth ?? DEFAULT_RASTER_WIDTH;
  const rasterHeight = options.rasterHeight ?? DEFAULT_RASTER_HEIGHT;
  const pages: Record<string, PageMeta> = {};
  const workspaceOrder: string[] = [];
  for (let i = 0; i < options.pageCount; i += 1) {
    const pageId = ids();
    pages[pageId] = {
      id: pageId,
      texts: [],
      rasterId: pageRasterId(projectId, pageId),
    };
    workspaceOrder.push(pageId);
  }
  return {
    projectId,
    name: options.name,
    rasterWidth,
    rasterHeight,
    pages,
    workspaceOrder,
    stock: [],
    trash: [],
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
    inkGeneration: 0,
    ...DEFAULT_UI_LAYOUT,
  };
}

export function cloneEditorDocument(doc: EditorDocument): EditorDocument {
  const pages: EditorDocument['pages'] = {};
  for (const [id, page] of Object.entries(doc.pages)) {
    pages[id] = {
      id: page.id,
      rasterId: page.rasterId,
      texts: page.texts.map((text) => ({ ...text, box: { ...text.box } })),
    };
  }
  return {
    ...doc,
    pages,
    workspaceOrder: [...doc.workspaceOrder],
    stock: doc.stock.map((item) => ({ ...item })),
    trash: [...(doc.trash ?? [])],
    pasteboardClips: doc.pasteboardClips.map((clip) => ({ ...clip })),
    pasteboardTexts: doc.pasteboardTexts.map((text) => ({ ...text, box: { ...text.box } })),
    tools: { ...doc.tools },
    pdf: doc.pdf ? clonePdfDocument(doc.pdf) : null,
    ...normalizeUiLayout(doc),
  };
}

const FORBIDDEN_DOCUMENT_KEYS = new Set(['uri', 'data', 'base64']);

export function assertStorableDocument(doc: EditorDocument): void {
  const json = JSON.stringify(doc);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  for (const key of FORBIDDEN_DOCUMENT_KEYS) {
    if (key in parsed) {
      throw new Error(`documents store forbids field: ${key}`);
    }
  }
  if (doc.pdf && 'uri' in (doc.pdf as object)) {
    throw new Error('documents store forbids pdf.uri');
  }
}
