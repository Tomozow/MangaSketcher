import { cloneEditorDocument, newPageMeta, type IdFactory } from './document';
import { layoutWorkspace } from './layout';
import { joinVerticalBody, rangeSelectBody } from './pdfText';
import { applyFontSizeToText, resizeTextBox } from './text';
import { clampSplit } from './uiLayout';
import { clampPdfPage } from './pdfView';
import type {
  ClipId,
  EditorDocument,
  PageId,
  PageText,
  PasteboardText,
  PdfTextItem,
  Rect,
  TextId,
  ToolId,
  ToolProperties,
} from './types';

const VIEW_ONLY = new Set<string>([
  'selectPage',
  'setTool',
  'setToolProperties',
  'setWorkspaceView',
  'setStockView',
  'setPdfView',
  'selectClip',
  'selectText',
  'setUiLayout',
]);

type ViewOnlyEditorAction =
  | { type: 'selectPage'; pageId: PageId }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'setToolProperties'; patch: Partial<ToolProperties> }
  | { type: 'setWorkspaceView'; zoom: number; panX: number; panY: number }
  | { type: 'setStockView'; zoom: number; panX: number; panY: number }
  | { type: 'setPdfView'; currentPage?: number; zoom?: number; panX?: number; panY?: number }
  | { type: 'selectClip'; clipId: ClipId | null }
  | { type: 'selectText'; textId: TextId | null }
  | {
      type: 'setUiLayout';
      workspacePdfSplit?: number;
      paletteStockSplit?: number;
      pdfViewerVisible?: boolean;
      sidebarCompact?: boolean;
      stockLayout?: 'free' | 'grid';
    };

type StatefulEditorAction = Exclude<EditorDocumentAction, ViewOnlyEditorAction>;

function isViewOnlyEditorAction(action: EditorDocumentAction): action is ViewOnlyEditorAction {
  return VIEW_ONLY.has(action.type);
}

export type EditorDocumentAction =
  | { type: 'selectPage'; pageId: PageId }
  | { type: 'appendPage' }
  | { type: 'insertAfterSelected' }
  | { type: 'deleteWorkspacePage'; pageId: PageId }
  | { type: 'deleteStockPage'; pageId: PageId }
  | { type: 'reorderWorkspace'; fromIndex: number; toIndex: number }
  | { type: 'movePageToStock'; pageId: PageId; x: number; y: number }
  | { type: 'returnStockToWorkspace'; pageId: PageId; readingIndex: number }
  | { type: 'placeStock'; pageId: PageId; x: number; y: number }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'setToolProperties'; patch: Partial<ToolProperties> }
  | { type: 'setWorkspaceView'; zoom: number; panX: number; panY: number }
  | { type: 'setStockView'; zoom: number; panX: number; panY: number }
  | { type: 'rename'; name: string }
  | { type: 'commitInkBake'; rasterId: string }
  | {
      type: 'commitMarqueeCut';
      pageId: PageId;
      clipId: ClipId;
      rasterId: string;
      workspaceX: number;
      workspaceY: number;
    }
  | { type: 'commitClipBake'; clipId: ClipId; pageId: PageId }
  | { type: 'transformClip'; clipId: ClipId; x?: number; y?: number; scale?: number; rotation?: number }
  | { type: 'selectClip'; clipId: ClipId | null }
  | {
      type: 'createText';
      attachment: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
      box: Rect;
      content?: string;
    }
  | { type: 'editText'; textId: TextId; content: string }
  | { type: 'moveText'; textId: TextId; x: number; y: number }
  | { type: 'resizeText'; textId: TextId; box: Rect }
  | { type: 'setTextColor'; textId: TextId; color: string }
  | { type: 'setTextFontSize'; textId: TextId; fontSize: number }
  | { type: 'attachTextToPage'; textId: TextId; pageId: PageId; pageBox: Rect }
  | { type: 'detachTextToPasteboard'; textId: TextId; workspaceBox: Rect }
  | { type: 'selectText'; textId: TextId | null }
  | {
      type: 'loadPdf';
      opfsPath: string;
      pageCount: number;
      sourceTextByPage: Record<number, PdfTextItem[]>;
      generation?: number;
    }
  | { type: 'setPdfView'; currentPage?: number; zoom?: number; panX?: number; panY?: number }
  | {
      type: 'dropPdfTextRange';
      pdfPage: number;
      range: Rect;
      attachment: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
      box: Rect;
    }
  | {
      type: 'setUiLayout';
      workspacePdfSplit?: number;
      paletteStockSplit?: number;
      pdfViewerVisible?: boolean;
      sidebarCompact?: boolean;
      stockLayout?: 'free' | 'grid';
    };

function findEditorText(
  doc: EditorDocument,
  textId: TextId,
): { node: PageText | PasteboardText; where: 'page' | 'pasteboard'; pageId?: PageId } | null {
  for (const page of Object.values(doc.pages)) {
    const t = page.texts.find((x) => x.id === textId);
    if (t) {
      return { node: t, where: 'page', pageId: page.id };
    }
  }
  const pb = doc.pasteboardTexts.find((x) => x.id === textId);
  return pb ? { node: pb, where: 'pasteboard' } : null;
}

function removePageFromWorkspace(doc: EditorDocument, pageId: PageId): void {
  doc.workspaceOrder = doc.workspaceOrder.filter((id) => id !== pageId);
  if (doc.selectedPageId === pageId) {
    doc.selectedPageId = doc.workspaceOrder[0] ?? null;
  }
}

export function reduceEditorDocument(
  state: EditorDocument,
  action: EditorDocumentAction,
  ids: IdFactory,
): EditorDocument {
  if (isViewOnlyEditorAction(action)) {
    return reduceEditorDocumentViewOnly(state, action);
  }

  const doc = cloneEditorDocument(state);
  const a = action as StatefulEditorAction;

  switch (a.type) {
    case 'appendPage': {
      const page = newPageMeta(doc, ids);
      doc.pages[page.id] = page;
      doc.workspaceOrder.push(page.id);
      doc.selectedPageId = page.id;
      return doc;
    }
    case 'insertAfterSelected': {
      if (!doc.selectedPageId) {
        return doc;
      }
      const index = doc.workspaceOrder.indexOf(doc.selectedPageId);
      if (index === -1) {
        return doc;
      }
      const page = newPageMeta(doc, ids);
      doc.pages[page.id] = page;
      doc.workspaceOrder.splice(index + 1, 0, page.id);
      doc.selectedPageId = page.id;
      return doc;
    }
    case 'deleteWorkspacePage': {
      if (!doc.workspaceOrder.includes(a.pageId)) {
        return doc;
      }
      removePageFromWorkspace(doc, a.pageId);
      delete doc.pages[a.pageId];
      return doc;
    }
    case 'deleteStockPage': {
      const item = doc.stock.find((s) => s.pageId === a.pageId);
      if (!item) {
        return doc;
      }
      doc.stock = doc.stock.filter((s) => s.pageId !== a.pageId);
      delete doc.pages[a.pageId];
      return doc;
    }
    case 'reorderWorkspace': {
      const { fromIndex, toIndex } = a;
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= doc.workspaceOrder.length ||
        toIndex >= doc.workspaceOrder.length
      ) {
        return doc;
      }
      const next = [...doc.workspaceOrder];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      doc.workspaceOrder = next;
      return doc;
    }
    case 'movePageToStock': {
      if (!doc.workspaceOrder.includes(a.pageId)) {
        return doc;
      }
      removePageFromWorkspace(doc, a.pageId);
      doc.stock.push({ pageId: a.pageId, x: a.x, y: a.y });
      return doc;
    }
    case 'returnStockToWorkspace': {
      const idx = doc.stock.findIndex((s) => s.pageId === a.pageId);
      if (idx === -1) {
        return doc;
      }
      doc.stock.splice(idx, 1);
      const insertAt = Math.max(0, Math.min(doc.workspaceOrder.length, a.readingIndex));
      doc.workspaceOrder.splice(insertAt, 0, a.pageId);
      doc.selectedPageId = a.pageId;
      return doc;
    }
    case 'placeStock': {
      const item = doc.stock.find((s) => s.pageId === a.pageId);
      if (!item) {
        return doc;
      }
      item.x = a.x;
      item.y = a.y;
      return doc;
    }
    case 'rename':
      doc.name = a.name;
      return doc;
    case 'commitInkBake':
      doc.inkGeneration += 1;
      return doc;
    case 'commitMarqueeCut': {
      const page = doc.pages[a.pageId];
      if (!page) {
        return doc;
      }
      doc.pasteboardClips.push({
        id: a.clipId,
        rasterId: a.rasterId,
        x: a.workspaceX,
        y: a.workspaceY,
        scale: 1,
        rotation: 0,
      });
      doc.selectedClipId = a.clipId;
      doc.selectedTextId = null;
      return doc;
    }
    case 'commitClipBake': {
      const clipIndex = doc.pasteboardClips.findIndex((c) => c.id === a.clipId);
      if (clipIndex === -1 || !doc.pages[a.pageId]) {
        return doc;
      }
      doc.pasteboardClips.splice(clipIndex, 1);
      if (doc.selectedClipId === a.clipId) {
        doc.selectedClipId = null;
      }
      return doc;
    }
    case 'transformClip': {
      const clip = doc.pasteboardClips.find((c) => c.id === a.clipId);
      if (!clip) {
        return doc;
      }
      if (a.x !== undefined) {
        clip.x = a.x;
      }
      if (a.y !== undefined) {
        clip.y = a.y;
      }
      if (a.scale !== undefined) {
        clip.scale = a.scale;
      }
      if (a.rotation !== undefined) {
        clip.rotation = a.rotation;
      }
      return doc;
    }
    case 'createText': {
      const id = ids();
      const text = {
        id,
        content: a.content ?? '',
        box: { ...a.box },
        fontSize: doc.tools.textFontSize,
        color: doc.tools.textColor,
      };
      if (a.attachment.kind === 'page') {
        const page = doc.pages[a.attachment.pageId];
        if (!page) {
          return doc;
        }
        page.texts.push(text);
      } else {
        doc.pasteboardTexts.push(text);
      }
      doc.selectedTextId = id;
      return doc;
    }
    case 'editText': {
      const found = findEditorText(doc, a.textId);
      if (found) {
        found.node.content = a.content;
      }
      return doc;
    }
    case 'moveText': {
      const found = findEditorText(doc, a.textId);
      if (found) {
        found.node.box.x = a.x;
        found.node.box.y = a.y;
      }
      return doc;
    }
    case 'resizeText': {
      const found = findEditorText(doc, a.textId);
      if (found) {
        const next = resizeTextBox(found.node, a.box);
        found.node.box = next.box;
        found.node.fontSize = next.fontSize;
      }
      return doc;
    }
    case 'setTextColor': {
      const found = findEditorText(doc, a.textId);
      if (found) {
        found.node.color = a.color;
      }
      return doc;
    }
    case 'setTextFontSize': {
      const found = findEditorText(doc, a.textId);
      if (found) {
        const next = applyFontSizeToText(found.node, a.fontSize);
        found.node.box = next.box;
        found.node.fontSize = next.fontSize;
      }
      return doc;
    }
    case 'attachTextToPage': {
      const pbIndex = doc.pasteboardTexts.findIndex((t) => t.id === a.textId);
      if (pbIndex === -1) {
        return doc;
      }
      const page = doc.pages[a.pageId];
      if (!page) {
        return doc;
      }
      const [item] = doc.pasteboardTexts.splice(pbIndex, 1);
      page.texts.push({
        id: item.id,
        content: item.content,
        box: { ...a.pageBox },
        fontSize: item.fontSize,
        color: item.color,
      });
      return doc;
    }
    case 'detachTextToPasteboard': {
      for (const page of Object.values(doc.pages)) {
        const i = page.texts.findIndex((t) => t.id === a.textId);
        if (i !== -1) {
          const [item] = page.texts.splice(i, 1);
          doc.pasteboardTexts.push({
            id: item.id,
            content: item.content,
            box: { ...a.workspaceBox },
            fontSize: item.fontSize,
            color: item.color,
          });
          break;
        }
      }
      return doc;
    }
    case 'loadPdf': {
      const sameSource = doc.pdf?.opfsPath === a.opfsPath;
      const keepPage = sameSource ? doc.pdf!.currentPage : 1;
      doc.pdf = {
        opfsPath: a.opfsPath,
        pageCount: a.pageCount,
        currentPage: clampPdfPage(keepPage, a.pageCount),
        zoom: sameSource ? doc.pdf!.zoom : 1,
        panX: sameSource ? doc.pdf!.panX : 0,
        panY: sameSource ? doc.pdf!.panY : 0,
        sourceTextByPage: a.sourceTextByPage,
        generation: a.generation ?? (sameSource ? doc.pdf!.generation : 1),
      };
      return doc;
    }
    case 'dropPdfTextRange': {
      if (!doc.pdf) {
        return doc;
      }
      const source = doc.pdf.sourceTextByPage[a.pdfPage] ?? [];
      const snapshot = source.map((item) => ({ ...item }));
      const selected = rangeSelectBody(source, a.range);
      const content = joinVerticalBody(selected);
      const id = ids();
      const text = {
        id,
        content,
        box: { ...a.box },
        fontSize: doc.tools.textFontSize,
        color: doc.tools.textColor,
      };
      if (a.attachment.kind === 'page') {
        doc.pages[a.attachment.pageId]?.texts.push(text);
      } else {
        doc.pasteboardTexts.push(text);
      }
      doc.selectedTextId = id;
      doc.pdf.sourceTextByPage[a.pdfPage] = snapshot;
      return doc;
    }
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

function reduceEditorDocumentViewOnly(
  state: EditorDocument,
  action: ViewOnlyEditorAction,
): EditorDocument {
  switch (action.type) {
    case 'selectPage':
      if (state.pages[action.pageId] && state.workspaceOrder.includes(action.pageId)) {
        return { ...state, selectedPageId: action.pageId };
      }
      return state;
    case 'setTool':
      return {
        ...state,
        tool: action.tool,
        selectedClipId: action.tool !== 'select' ? null : state.selectedClipId,
      };
    case 'setToolProperties':
      return { ...state, tools: { ...state.tools, ...action.patch } };
    case 'setWorkspaceView':
      return {
        ...state,
        workspaceZoom: action.zoom,
        workspacePanX: action.panX,
        workspacePanY: action.panY,
      };
    case 'setStockView':
      return {
        ...state,
        stockZoom: action.zoom,
        stockPanX: action.panX,
        stockPanY: action.panY,
      };
    case 'setPdfView':
      if (!state.pdf) {
        return state;
      }
      const pdf = { ...state.pdf };
      if (action.currentPage !== undefined) {
        pdf.currentPage = clampPdfPage(action.currentPage, pdf.pageCount);
      }
      if (action.zoom !== undefined) {
        pdf.zoom = action.zoom;
      }
      if (action.panX !== undefined) {
        pdf.panX = action.panX;
      }
      if (action.panY !== undefined) {
        pdf.panY = action.panY;
      }
      return { ...state, pdf };
    case 'selectClip':
      return {
        ...state,
        selectedClipId: action.clipId,
        selectedTextId: action.clipId ? null : state.selectedTextId,
      };
    case 'selectText':
      return {
        ...state,
        selectedTextId: action.textId,
        selectedClipId: action.textId ? null : state.selectedClipId,
      };
    case 'setUiLayout': {
      const patch: Partial<EditorDocument> = {};
      if (action.workspacePdfSplit !== undefined) {
        patch.workspacePdfSplit = clampSplit(action.workspacePdfSplit);
      }
      if (action.paletteStockSplit !== undefined) {
        patch.paletteStockSplit = clampSplit(action.paletteStockSplit);
      }
      if (action.pdfViewerVisible !== undefined) {
        patch.pdfViewerVisible = action.pdfViewerVisible;
      }
      if (action.sidebarCompact !== undefined) {
        patch.sidebarCompact = action.sidebarCompact;
      }
      if (action.stockLayout !== undefined) {
        patch.stockLayout = action.stockLayout === 'grid' ? 'grid' : 'free';
      }
      return { ...state, ...patch };
    }
    default:
      return state;
  }
}

export { layoutWorkspace };
