import { cloneDocument, newPage, type IdFactory } from './document';
import { layoutWorkspace } from './layout';
import { brushRadius, resolvePointerIntent } from './pointers';
import { compositeRaster, cutRect, parseHexColor, stampBrush } from './raster';
import { wrapExtractedText, workspaceFontSizeFromTool } from './pdfExtractPack';
import { joinVerticalBody, rangeSelectBody } from './pdfText';
import { stampStroke, type StrokePoint } from './stroke';
import { applyFontSizeToText, findText, resizeTextBox } from './text';
import { fitTextBoxToContent } from './textWrap';
import { clampSplit, clampPdfDrawerHeight, clampPdfDrawerWidth } from './uiLayout';
import {
  clampColumnGap,
  clampPairGap,
  clampStoredPagesPerColumn,
} from './stripGeometry';
import { clampPdfPage, clampPdfZoom, keepPdfViewOnReload, pdfViewAfterLoad } from './pdfView';
import type {
  ClipId,
  DocumentState,
  PageId,
  PdfTextItem,
  PointerEvent,
  Rect,
  TextId,
  ToolId,
  ToolProperties,
} from './types';

export type InkTarget = { kind: 'page'; pageId: PageId } | { kind: 'clip'; clipId: ClipId };

export type DocumentAction =
  | { type: 'selectPage'; pageId: PageId }
  | { type: 'appendPage' }
  | { type: 'insertAfterSelected' }
  | { type: 'deleteWorkspacePage'; pageId: PageId }
  | { type: 'deleteStockPage'; pageId: PageId }
  | { type: 'returnTrashToWorkspace'; pageId: PageId; readingIndex: number }
  | { type: 'emptyTrash' }
  | { type: 'reorderWorkspace'; fromIndex: number; toIndex: number }
  | { type: 'movePageToStock'; pageId: PageId; x: number; y: number }
  | { type: 'returnStockToWorkspace'; pageId: PageId; readingIndex: number }
  | { type: 'placeStock'; pageId: PageId; x: number; y: number }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'setToolProperties'; patch: Partial<ToolProperties> }
  | { type: 'setWorkspaceView'; zoom: number; panX: number; panY: number }
  | { type: 'setStockView'; zoom: number; panX: number; panY: number }
  | { type: 'rename'; name: string }
  | {
      type: 'stampInk';
      target: InkTarget;
      x: number;
      y: number;
      pressure: number;
      pointerKind: PointerEvent['kind'];
      erase: boolean;
    }
  | {
      type: 'strokeInk';
      target: InkTarget;
      points: StrokePoint[];
      pointerKind: PointerEvent['kind'];
      erase: boolean;
    }
  | { type: 'marqueeCut'; pageId: PageId; rect: Rect; workspaceX: number; workspaceY: number }
  | { type: 'transformClip'; clipId: ClipId; x?: number; y?: number; scale?: number; rotation?: number }
  | { type: 'bakeClipOntoPage'; clipId: ClipId; pageId: PageId; pageLocalX: number; pageLocalY: number }
  | { type: 'selectClip'; clipId: ClipId | null }
  | {
      type: 'createText';
      attachment: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
      box: Rect;
      content?: string;
    }
  | { type: 'editText'; textId: TextId; content: string }
  | { type: 'deleteText'; textId: TextId }
  | { type: 'moveText'; textId: TextId; x: number; y: number }
  | { type: 'resizeText'; textId: TextId; box: Rect }
  | { type: 'setTextColor'; textId: TextId; color: string }
  | { type: 'setTextFontSize'; textId: TextId; fontSize: number }
  | { type: 'attachTextToPage'; textId: TextId; pageId: PageId; pageBox: Rect; fontSize?: number }
  | { type: 'detachTextToPasteboard'; textId: TextId; workspaceBox: Rect; fontSize?: number }
  | { type: 'selectText'; textId: TextId | null }
  | {
      type: 'loadPdf';
      opfsPath: string;
      pageCount: number;
      sourceTextByPage: Record<number, PdfTextItem[]>;
      generation?: number;
      sourceFingerprint?: string;
    }
  | { type: 'setPdfView'; currentPage?: number; zoom?: number; panX?: number; panY?: number }
  | { type: 'setPdfExtractSanitizePunctuation'; enabled: boolean }
  | {
      type: 'dropPdfTextRange';
      pdfPage: number;
      range: Rect;
      attachment: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
      box: Rect;
      content?: string;
      fontSize?: number;
    }
  | {
      type: 'setUiLayout';
      workspacePdfSplit?: number;
      paletteStockSplit?: number;
      pdfDrawerWidth?: number;
      pdfDrawerHeight?: number;
      pdfViewerVisible?: boolean;
      sidebarCompact?: boolean;
      stockLayout?: 'free' | 'grid';
      stockPane?: 'stock' | 'trash';
      pagesPerColumn?: number;
      pairGap?: number;
      showPairDivider?: boolean;
      columnGap?: number;
    };

export function pageNumber(doc: DocumentState, pageId: PageId): number | null {
  const i = doc.workspaceOrder.indexOf(pageId);
  return i === -1 ? null : i + 1;
}

function addPageToTrash(doc: DocumentState, pageId: PageId): void {
  if (!doc.trash.includes(pageId)) {
    doc.trash.push(pageId);
  }
}

function removePageFromWorkspace(doc: DocumentState, pageId: PageId): void {
  doc.workspaceOrder = doc.workspaceOrder.filter((id) => id !== pageId);
  if (doc.selectedPageId === pageId) {
    doc.selectedPageId = doc.workspaceOrder[0] ?? null;
  }
}

export function reduceTestDocument(
  state: DocumentState,
  action: DocumentAction,
  ids: IdFactory,
): DocumentState {
  const doc = cloneDocument(state);

  switch (action.type) {
    case 'selectPage':
      if (doc.pages[action.pageId] && doc.workspaceOrder.includes(action.pageId)) {
        doc.selectedPageId = action.pageId;
      }
      return doc;
    case 'appendPage': {
      const page = newPage(doc, ids);
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
      const page = newPage(doc, ids);
      doc.pages[page.id] = page;
      doc.workspaceOrder.splice(index + 1, 0, page.id);
      doc.selectedPageId = page.id;
      return doc;
    }
    case 'deleteWorkspacePage': {
      if (!doc.workspaceOrder.includes(action.pageId)) {
        return doc;
      }
      removePageFromWorkspace(doc, action.pageId);
      addPageToTrash(doc, action.pageId);
      return doc;
    }
    case 'deleteStockPage': {
      const item = doc.stock.find((s) => s.pageId === action.pageId);
      if (!item) {
        return doc;
      }
      doc.stock = doc.stock.filter((s) => s.pageId !== action.pageId);
      addPageToTrash(doc, action.pageId);
      return doc;
    }
    case 'returnTrashToWorkspace': {
      const idx = doc.trash.indexOf(action.pageId);
      if (idx === -1) {
        return doc;
      }
      doc.trash.splice(idx, 1);
      const insertAt = Math.max(0, Math.min(doc.workspaceOrder.length, action.readingIndex));
      doc.workspaceOrder.splice(insertAt, 0, action.pageId);
      doc.selectedPageId = action.pageId;
      return doc;
    }
    case 'emptyTrash': {
      if (doc.trash.length === 0) {
        return doc;
      }
      for (const pageId of doc.trash) {
        delete doc.pages[pageId];
      }
      doc.trash = [];
      return doc;
    }
    case 'reorderWorkspace': {
      const { fromIndex, toIndex } = action;
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
      if (!doc.workspaceOrder.includes(action.pageId)) {
        return doc;
      }
      removePageFromWorkspace(doc, action.pageId);
      doc.stock.push({ pageId: action.pageId, x: action.x, y: action.y });
      return doc;
    }
    case 'returnStockToWorkspace': {
      const idx = doc.stock.findIndex((s) => s.pageId === action.pageId);
      if (idx === -1) {
        return doc;
      }
      doc.stock.splice(idx, 1);
      const insertAt = Math.max(0, Math.min(doc.workspaceOrder.length, action.readingIndex));
      doc.workspaceOrder.splice(insertAt, 0, action.pageId);
      doc.selectedPageId = action.pageId;
      return doc;
    }
    case 'placeStock': {
      const item = doc.stock.find((s) => s.pageId === action.pageId);
      if (!item) {
        return doc;
      }
      item.x = action.x;
      item.y = action.y;
      return doc;
    }
    case 'setTool':
      doc.tool = action.tool;
      if (action.tool !== 'select') {
        doc.selectedClipId = null;
      }
      return doc;
    case 'setToolProperties':
      doc.tools = { ...doc.tools, ...action.patch };
      return doc;
    case 'setWorkspaceView':
      doc.workspaceZoom = action.zoom;
      doc.workspacePanX = action.panX;
      doc.workspacePanY = action.panY;
      return doc;
    case 'setStockView':
      doc.stockZoom = action.zoom;
      doc.stockPanX = action.panX;
      doc.stockPanY = action.panY;
      return doc;
    case 'rename':
      doc.name = action.name;
      return doc;
    case 'stampInk': {
      const color = parseHexColor(
        action.erase ? '#000000' : doc.tools.penColor,
        action.erase ? doc.tools.eraserOpacity : doc.tools.penOpacity,
      );
      const radius = brushRadius(
        action.erase ? doc.tools.eraserSize : doc.tools.penSize,
        action.pressure,
        action.pointerKind,
        doc.tools.pressureEnabled !== false,
      );
      if (action.target.kind === 'page') {
        const page = doc.pages[action.target.pageId];
        if (!page) {
          return doc;
        }
        stampBrush(page.raster, action.x, action.y, radius, color, action.erase);
      } else if (action.target.kind === 'clip') {
        const clipId = action.target.clipId;
        const clip = doc.pasteboardClips.find((c) => c.id === clipId);
        if (!clip) {
          return doc;
        }
        stampBrush(clip.raster, action.x, action.y, radius, color, action.erase);
      }
      return doc;
    }
    case 'strokeInk': {
      const color = parseHexColor(
        action.erase ? '#000000' : doc.tools.penColor,
        action.erase ? doc.tools.eraserOpacity : doc.tools.penOpacity,
      );
      const radiusFor = (pressure: number) =>
        brushRadius(
          action.erase ? doc.tools.eraserSize : doc.tools.penSize,
          pressure,
          action.pointerKind,
          doc.tools.pressureEnabled !== false,
        );
      if (action.target.kind === 'page') {
        const page = doc.pages[action.target.pageId];
        if (!page) {
          return doc;
        }
        stampStroke(page.raster, action.points, radiusFor, color, action.erase);
      } else {
        const inkTarget = action.target;
        if (inkTarget.kind !== 'clip') {
          return doc;
        }
        const clip = doc.pasteboardClips.find((c) => c.id === inkTarget.clipId);
        if (!clip) {
          return doc;
        }
        stampStroke(clip.raster, action.points, radiusFor, color, action.erase);
      }
      return doc;
    }
    case 'marqueeCut': {
      const page = doc.pages[action.pageId];
      if (!page) {
        return doc;
      }
      const cut = cutRect(page.raster, action.rect);
      const clipId = ids();
      doc.pasteboardClips.push({
        id: clipId,
        raster: cut,
        x: action.workspaceX,
        y: action.workspaceY,
        scale: 1,
        rotation: 0,
      });
      doc.selectedClipId = clipId;
      doc.selectedTextId = null;
      return doc;
    }
    case 'transformClip': {
      const clip = doc.pasteboardClips.find((c) => c.id === action.clipId);
      if (!clip) {
        return doc;
      }
      if (action.x !== undefined) {
        clip.x = action.x;
      }
      if (action.y !== undefined) {
        clip.y = action.y;
      }
      if (action.scale !== undefined) {
        clip.scale = action.scale;
      }
      if (action.rotation !== undefined) {
        clip.rotation = action.rotation;
      }
      return doc;
    }
    case 'bakeClipOntoPage': {
      const clipIndex = doc.pasteboardClips.findIndex((c) => c.id === action.clipId);
      const page = doc.pages[action.pageId];
      if (clipIndex === -1 || !page) {
        return doc;
      }
      const [clip] = doc.pasteboardClips.splice(clipIndex, 1);
      compositeRaster(page.raster, clip.raster, action.pageLocalX, action.pageLocalY, clip.scale, clip.rotation);
      if (doc.selectedClipId === action.clipId) {
        doc.selectedClipId = null;
      }
      return doc;
    }
    case 'selectClip':
      doc.selectedClipId = action.clipId;
      if (action.clipId) {
        doc.selectedTextId = null;
      }
      return doc;
    case 'createText': {
      const id = ids();
      const text = {
        id,
        content: action.content ?? '',
        box: { ...action.box },
        fontSize: doc.tools.textFontSize,
        color: doc.tools.textColor,
      };
      if (action.attachment.kind === 'page') {
        const page = doc.pages[action.attachment.pageId];
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
      const found = findText(doc, action.textId);
      if (found) {
        found.node.content = action.content;
        const layoutFont =
          found.where === 'pasteboard'
            ? workspaceFontSizeFromTool(found.node.fontSize, doc.rasterWidth)
            : found.node.fontSize;
        found.node.box = fitTextBoxToContent(found.node.box, action.content, layoutFont);
      }
      return doc;
    }
    case 'deleteText': {
      for (const page of Object.values(doc.pages)) {
        const index = page.texts.findIndex((t) => t.id === action.textId);
        if (index === -1) {
          continue;
        }
        page.texts.splice(index, 1);
        if (doc.selectedTextId === action.textId) {
          doc.selectedTextId = null;
        }
        return doc;
      }
      const pbIndex = doc.pasteboardTexts.findIndex((t) => t.id === action.textId);
      if (pbIndex !== -1) {
        doc.pasteboardTexts.splice(pbIndex, 1);
        if (doc.selectedTextId === action.textId) {
          doc.selectedTextId = null;
        }
      }
      return doc;
    }
    case 'moveText': {
      const found = findText(doc, action.textId);
      if (found && Number.isFinite(action.x) && Number.isFinite(action.y)) {
        found.node.box.x = action.x;
        found.node.box.y = action.y;
      }
      return doc;
    }
    case 'resizeText': {
      const found = findText(doc, action.textId);
      if (found) {
        const next = resizeTextBox(found.node, action.box);
        found.node.box = next.box;
        found.node.fontSize = next.fontSize;
      }
      return doc;
    }
    case 'setTextColor': {
      const found = findText(doc, action.textId);
      if (found) {
        found.node.color = action.color;
      }
      return doc;
    }
    case 'setTextFontSize': {
      const found = findText(doc, action.textId);
      if (found) {
        const next = applyFontSizeToText(found.node, action.fontSize);
        found.node.box = next.box;
        found.node.fontSize = next.fontSize;
      }
      return doc;
    }
    case 'attachTextToPage': {
      const pbIndex = doc.pasteboardTexts.findIndex((t) => t.id === action.textId);
      if (pbIndex === -1) {
        return doc;
      }
      const page = doc.pages[action.pageId];
      if (!page) {
        return doc;
      }
      const [item] = doc.pasteboardTexts.splice(pbIndex, 1);
      page.texts.push({
        id: item.id,
        content: item.content,
        box: { ...action.pageBox },
        fontSize: action.fontSize ?? item.fontSize,
        color: item.color,
      });
      return doc;
    }
    case 'detachTextToPasteboard': {
      for (const page of Object.values(doc.pages)) {
        const i = page.texts.findIndex((t) => t.id === action.textId);
        if (i !== -1) {
          const [item] = page.texts.splice(i, 1);
          doc.pasteboardTexts.push({
            id: item.id,
            content: item.content,
            box: { ...action.workspaceBox },
            fontSize: action.fontSize ?? item.fontSize,
            color: item.color,
          });
          break;
        }
      }
      return doc;
    }
    case 'selectText':
      doc.selectedTextId = action.textId;
      if (action.textId) {
        doc.selectedClipId = null;
      }
      return doc;
    case 'loadPdf': {
      const view = pdfViewAfterLoad(doc.pdf, {
        opfsPath: action.opfsPath,
        pageCount: action.pageCount,
        fingerprint: action.sourceFingerprint,
      });
      const sameSource = keepPdfViewOnReload(doc.pdf, {
        opfsPath: action.opfsPath,
        fingerprint: action.sourceFingerprint,
      });
      doc.pdf = {
        opfsPath: action.opfsPath,
        pageCount: action.pageCount,
        currentPage: view.currentPage,
        zoom: view.zoom,
        panX: view.panX,
        panY: view.panY,
        sourceTextByPage: action.sourceTextByPage,
        generation: action.generation ?? (sameSource ? doc.pdf!.generation : 1),
        sourceFingerprint: action.sourceFingerprint ?? (sameSource ? doc.pdf?.sourceFingerprint : undefined),
        extractSanitizePunctuation: view.extractSanitizePunctuation,
      };
      return doc;
    }
    case 'setPdfView':
      if (!doc.pdf) {
        return doc;
      }
      if (action.currentPage !== undefined) {
        doc.pdf.currentPage = clampPdfPage(action.currentPage, doc.pdf.pageCount);
      }
      if (action.zoom !== undefined) {
        doc.pdf.zoom = clampPdfZoom(action.zoom);
      }
      if (action.panX !== undefined) {
        doc.pdf.panX = action.panX;
      }
      if (action.panY !== undefined) {
        doc.pdf.panY = action.panY;
      }
      return doc;
    case 'setPdfExtractSanitizePunctuation':
      if (!doc.pdf) {
        return doc;
      }
      doc.pdf.extractSanitizePunctuation = action.enabled;
      return doc;
    case 'dropPdfTextRange': {
      if (!doc.pdf) {
        return doc;
      }
      const source = doc.pdf.sourceTextByPage[action.pdfPage] ?? [];
      const snapshot = source.map((item) => ({ ...item }));
      const selected = rangeSelectBody(source, action.range);
      const content = wrapExtractedText(action.content ?? joinVerticalBody(selected));
      const id = ids();
      const text = {
        id,
        content,
        box: { ...action.box },
        fontSize: action.fontSize ?? doc.tools.textFontSize,
        color: doc.tools.textColor,
      };
      if (action.attachment.kind === 'page') {
        doc.pages[action.attachment.pageId]?.texts.push(text);
      } else {
        doc.pasteboardTexts.push(text);
      }
      doc.selectedTextId = id;
      doc.pdf.sourceTextByPage[action.pdfPage] = snapshot;
      return doc;
    }
    case 'setUiLayout':
      if (action.workspacePdfSplit !== undefined) {
        doc.workspacePdfSplit = clampSplit(action.workspacePdfSplit);
      }
      if (action.paletteStockSplit !== undefined) {
        doc.paletteStockSplit = clampSplit(action.paletteStockSplit);
      }
      if (action.pdfDrawerWidth !== undefined) {
        doc.pdfDrawerWidth = clampPdfDrawerWidth(action.pdfDrawerWidth);
      }
      if (action.pdfDrawerHeight !== undefined) {
        doc.pdfDrawerHeight = clampPdfDrawerHeight(action.pdfDrawerHeight);
      }
      if (action.pdfViewerVisible !== undefined) {
        doc.pdfViewerVisible = action.pdfViewerVisible;
      }
      if (action.sidebarCompact !== undefined) {
        doc.sidebarCompact = action.sidebarCompact;
      }
      if (action.stockLayout !== undefined) {
        doc.stockLayout = action.stockLayout === 'grid' ? 'grid' : 'free';
      }
      if (action.stockPane !== undefined) {
        doc.stockPane = action.stockPane === 'trash' ? 'trash' : 'stock';
      }
      if (action.pagesPerColumn !== undefined) {
        doc.pagesPerColumn = clampStoredPagesPerColumn(action.pagesPerColumn);
      }
      if (action.pairGap !== undefined) {
        doc.pairGap = clampPairGap(action.pairGap);
      }
      if (action.showPairDivider !== undefined) {
        doc.showPairDivider = action.showPairDivider;
      }
      if (action.columnGap !== undefined) {
        doc.columnGap = clampColumnGap(action.columnGap);
      }
      return doc;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function applyStampFromPointer(
  doc: DocumentState,
  event: PointerEvent,
  target: InkTarget,
  ids: IdFactory,
): DocumentState {
  const intent = resolvePointerIntent(doc.tool, event);
  if (intent.type !== 'drawInk' && intent.type !== 'eraseInk') {
    return doc;
  }
  return reduceTestDocument(
    doc,
    {
      type: 'stampInk',
      target,
      x: event.x,
      y: event.y,
      pressure: event.pressure,
      pointerKind: event.kind,
      erase: intent.type === 'eraseInk',
    },
    ids,
  );
}

/** @deprecated Test-only — use reduceTestDocument or reduceEditorDocument in production. */
export const reduceDocument = reduceTestDocument;

export { layoutWorkspace, resolvePointerIntent };
