import { cloneDocument, newPage, type IdFactory } from './document';
import { layoutWorkspace } from './layout';
import { brushOpacity, brushRadius, pressureAffectsOf, resolvePointerIntent } from './pointers';
import { compositeRaster, cutRect, parseHexColor, stampBrush } from './raster';
import { pageTextToPasteboard, wrapExtractedText, workspaceFontSizeFromTool } from './pdfExtractPack';
import { joinVerticalBody, rangeSelectBody } from './pdfText';
import { stampStroke, type StrokePoint } from './stroke';
import { applyFontSizeToText, findText, isTextContentEmpty, resizeTextBox } from './text';
import { cloneStockAttachedTexts, restoreAttachedTextBoxes } from './stockClipAttach';
import { findStockClip, findStockPage, findStockText, isStockClipItem, isStockPageItem, isStockTextItem, stockedTextIds } from './stockItems';
import { fitTextBoxToContent } from './textWrap';
import {
  clampSplit,
  clampPdfDrawerHeight,
  clampPdfDrawerWidth,
  clampStockDrawerHeight,
  clampStockDrawerWidth,
} from './uiLayout';
import {
  clampColumnGap,
  clampPairGap,
  clampStoredPagesPerColumn,
} from './stripGeometry';
import { clampPdfPage, clampPdfZoom, keepPdfViewOnReload, pdfViewAfterLoad } from './pdfView';
import { isSelectionTool, writingModeOf } from './types';
import type {
  ClipId,
  DocumentState,
  PageId,
  PdfTextItem,
  PointerEvent,
  Rect,
  StockAttachedText,
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
  | { type: 'reorderStock'; fromIndex: number; toIndex: number }
  | { type: 'swapStockPositions'; fromIndex: number; toIndex: number }
  | { type: 'movePageToStock'; pageId: PageId; x: number; y: number }
  | { type: 'returnStockToWorkspace'; pageId: PageId; readingIndex: number }
  | { type: 'placeStock'; pageId: PageId; x: number; y: number }
  | { type: 'moveClipToStock'; clipId: ClipId; x: number; y: number; attachedTexts?: StockAttachedText[] }
  | { type: 'moveTextToStock'; textId: TextId; x: number; y: number }
  | { type: 'returnStockClip'; clipId: ClipId; x: number; y: number }
  | { type: 'returnStockText'; textId: TextId; x: number; y: number }
  | { type: 'returnTrashClip'; clipId: ClipId; x: number; y: number }
  | { type: 'returnTrashText'; textId: TextId; x: number; y: number }
  | { type: 'placeStockClip'; clipId: ClipId; x: number; y: number }
  | { type: 'placeStockText'; textId: TextId; x: number; y: number }
  | { type: 'deleteStockClip'; clipId: ClipId }
  | { type: 'deleteStockText'; textId: TextId }
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
  | { type: 'transformClip'; clipId: ClipId; x?: number; y?: number; scale?: number; scaleY?: number; rotation?: number }
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
      stockDrawerWidth?: number;
      stockDrawerHeight?: number;
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

function ensureTrashLists(doc: DocumentState): void {
  if (!doc.trashClips) {
    doc.trashClips = [];
  }
  if (!doc.trashTexts) {
    doc.trashTexts = [];
  }
  if (!doc.trashClipAttachedTexts) {
    doc.trashClipAttachedTexts = {};
  }
}

function addClipToTrash(doc: DocumentState, clipId: ClipId): void {
  ensureTrashLists(doc);
  if (!doc.pasteboardClips.some((clip) => clip.id === clipId)) {
    return;
  }
  const stocked = findStockClip(doc.stock, clipId);
  if (stocked?.attachedTexts && stocked.attachedTexts.length > 0) {
    doc.trashClipAttachedTexts![clipId] = cloneStockAttachedTexts(stocked.attachedTexts) ?? [];
  } else {
    delete doc.trashClipAttachedTexts![clipId];
  }
  doc.stock = doc.stock.filter((item) => !(isStockClipItem(item) && item.clipId === clipId));
  if (!doc.trashClips.includes(clipId)) {
    doc.trashClips.push(clipId);
  }
  if (doc.selectedClipId === clipId) {
    doc.selectedClipId = null;
  }
}

function addTextToTrash(doc: DocumentState, textId: TextId): void {
  ensureTrashLists(doc);
  const found = findText(doc, textId);
  if (!found) {
    return;
  }
  if (isTextContentEmpty(found.node.content)) {
    if (found.where === 'page' && found.pageId) {
      const page = doc.pages[found.pageId];
      page.texts = page.texts.filter((item) => item.id !== textId);
    } else {
      doc.pasteboardTexts = doc.pasteboardTexts.filter((item) => item.id !== textId);
    }
    doc.stock = doc.stock.filter((item) => !(isStockTextItem(item) && item.textId === textId));
    if (doc.selectedTextId === textId) {
      doc.selectedTextId = null;
    }
    return;
  }
  if (found.where === 'page' && found.pageId) {
    const page = doc.pages[found.pageId];
    const index = page.texts.findIndex((item) => item.id === textId);
    if (index !== -1) {
      const [taken] = page.texts.splice(index, 1);
      if (taken) {
        const converted = pageTextToPasteboard(
          taken.box,
          taken.fontSize,
          doc.rasterWidth,
          doc.rasterHeight,
        );
        doc.pasteboardTexts.push({
          id: taken.id,
          content: taken.content,
          box: converted.box,
          fontSize: converted.fontSize,
          color: taken.color,
        });
      }
    }
  }
  doc.stock = doc.stock.filter((item) => !(isStockTextItem(item) && item.textId === textId));
  if (!doc.trashTexts.includes(textId)) {
    doc.trashTexts.push(textId);
  }
  if (doc.selectedTextId === textId) {
    doc.selectedTextId = null;
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
      const item = findStockPage(doc.stock, action.pageId);
      if (!item) {
        return doc;
      }
      doc.stock = doc.stock.filter((s) => !isStockPageItem(s) || s.pageId !== action.pageId);
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
      ensureTrashLists(doc);
      if (doc.trash.length === 0 && doc.trashClips.length === 0 && doc.trashTexts.length === 0) {
        return doc;
      }
      for (const pageId of doc.trash) {
        delete doc.pages[pageId];
      }
      const clipIds = new Set(doc.trashClips);
      const bundledTextIds = Object.values(doc.trashClipAttachedTexts ?? {}).flatMap((texts) =>
        texts.map((item) => item.textId),
      );
      const textIds = new Set([...doc.trashTexts, ...bundledTextIds]);
      doc.pasteboardClips = doc.pasteboardClips.filter((clip) => !clipIds.has(clip.id));
      doc.pasteboardTexts = doc.pasteboardTexts.filter((text) => !textIds.has(text.id));
      if (doc.selectedClipId && clipIds.has(doc.selectedClipId)) {
        doc.selectedClipId = null;
      }
      if (doc.selectedTextId && textIds.has(doc.selectedTextId)) {
        doc.selectedTextId = null;
      }
      doc.trash = [];
      doc.trashClips = [];
      doc.trashTexts = [];
      doc.trashClipAttachedTexts = {};
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
    case 'reorderStock': {
      const { fromIndex, toIndex } = action;
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= doc.stock.length ||
        toIndex >= doc.stock.length
      ) {
        return doc;
      }
      const next = [...doc.stock];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) {
        return doc;
      }
      next.splice(toIndex, 0, moved);
      doc.stock = next;
      return doc;
    }
    case 'swapStockPositions': {
      const { fromIndex, toIndex } = action;
      const left = doc.stock[fromIndex];
      const right = doc.stock[toIndex];
      if (!left || !right || fromIndex === toIndex) {
        return doc;
      }
      const x = left.x;
      const y = left.y;
      left.x = right.x;
      left.y = right.y;
      right.x = x;
      right.y = y;
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
      const idx = doc.stock.findIndex((s) => isStockPageItem(s) && s.pageId === action.pageId);
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
      const item = findStockPage(doc.stock, action.pageId);
      if (!item) {
        return doc;
      }
      item.x = action.x;
      item.y = action.y;
      return doc;
    }
    case 'moveClipToStock': {
      if (!doc.pasteboardClips.some((clip) => clip.id === action.clipId)) {
        return doc;
      }
      if (findStockClip(doc.stock, action.clipId)) {
        return doc;
      }
      const attached = cloneStockAttachedTexts(action.attachedTexts) ?? [];
      doc.stock.push({
        kind: 'clip',
        clipId: action.clipId,
        x: action.x,
        y: action.y,
        attachedTexts: attached.length > 0 ? attached : undefined,
      });
      if (doc.selectedClipId === action.clipId) {
        doc.selectedClipId = null;
      }
      return doc;
    }
    case 'moveTextToStock': {
      const found = findText(doc, action.textId);
      if (!found) {
        return doc;
      }
      if (findStockText(doc.stock, action.textId) || stockedTextIds(doc.stock).has(action.textId)) {
        return doc;
      }
      if (found.where === 'page' && found.pageId) {
        const page = doc.pages[found.pageId];
        const index = page.texts.findIndex((t) => t.id === action.textId);
        if (index !== -1) {
          const [taken] = page.texts.splice(index, 1);
          if (taken) {
            const converted = pageTextToPasteboard(
              taken.box,
              taken.fontSize,
              doc.rasterWidth,
              doc.rasterHeight,
            );
            doc.pasteboardTexts.push({
              id: taken.id,
              content: taken.content,
              box: converted.box,
              fontSize: converted.fontSize,
              color: taken.color,
            });
          }
        }
      }
      doc.stock.push({ kind: 'text', textId: action.textId, x: action.x, y: action.y });
      if (doc.selectedTextId === action.textId) {
        doc.selectedTextId = null;
      }
      return doc;
    }
    case 'returnStockClip': {
      const idx = doc.stock.findIndex((s) => isStockClipItem(s) && s.clipId === action.clipId);
      if (idx === -1) {
        return doc;
      }
      const [removed] = doc.stock.splice(idx, 1);
      const clip = doc.pasteboardClips.find((c) => c.id === action.clipId);
      if (clip) {
        clip.x = action.x;
        clip.y = action.y;
      }
      restoreAttachedTextBoxes(
        doc.pasteboardTexts,
        action.x,
        action.y,
        removed && isStockClipItem(removed) ? removed.attachedTexts : undefined,
      );
      const attached = removed && isStockClipItem(removed) ? removed.attachedTexts : undefined;
      if (attached && attached.length > 0) {
        doc.selectedClipId = action.clipId;
        doc.selectedTextId = attached[attached.length - 1]!.textId;
      }
      return doc;
    }
    case 'returnStockText': {
      const idx = doc.stock.findIndex((s) => isStockTextItem(s) && s.textId === action.textId);
      if (idx === -1) {
        return doc;
      }
      doc.stock.splice(idx, 1);
      const text = doc.pasteboardTexts.find((t) => t.id === action.textId);
      if (text) {
        text.box = { ...text.box, x: action.x, y: action.y };
      }
      return doc;
    }
    case 'returnTrashClip': {
      ensureTrashLists(doc);
      const idx = doc.trashClips.indexOf(action.clipId);
      if (idx === -1) {
        return doc;
      }
      doc.trashClips.splice(idx, 1);
      const attached = doc.trashClipAttachedTexts?.[action.clipId];
      if (doc.trashClipAttachedTexts) {
        delete doc.trashClipAttachedTexts[action.clipId];
      }
      const clip = doc.pasteboardClips.find((c) => c.id === action.clipId);
      if (clip) {
        clip.x = action.x;
        clip.y = action.y;
      }
      restoreAttachedTextBoxes(doc.pasteboardTexts, action.x, action.y, attached);
      if (attached && attached.length > 0) {
        doc.selectedClipId = action.clipId;
        doc.selectedTextId = attached[attached.length - 1]!.textId;
      }
      return doc;
    }
    case 'returnTrashText': {
      ensureTrashLists(doc);
      const idx = doc.trashTexts.indexOf(action.textId);
      if (idx === -1) {
        return doc;
      }
      doc.trashTexts.splice(idx, 1);
      const text = doc.pasteboardTexts.find((t) => t.id === action.textId);
      if (text) {
        text.box = { ...text.box, x: action.x, y: action.y };
      }
      return doc;
    }
    case 'placeStockClip': {
      const item = findStockClip(doc.stock, action.clipId);
      if (!item) {
        return doc;
      }
      item.x = action.x;
      item.y = action.y;
      return doc;
    }
    case 'placeStockText': {
      const item = findStockText(doc.stock, action.textId);
      if (!item) {
        return doc;
      }
      item.x = action.x;
      item.y = action.y;
      return doc;
    }
    case 'deleteStockClip': {
      addClipToTrash(doc, action.clipId);
      return doc;
    }
    case 'deleteStockText': {
      addTextToTrash(doc, action.textId);
      return doc;
    }
    case 'setTool':
      doc.tool = action.tool;
      if (action.tool === 'lasso') {
        doc.tools = { ...doc.tools, selectLasso: true };
      }
      if (!isSelectionTool(action.tool)) {
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
      const affect = pressureAffectsOf(doc.tools, action.erase);
      const color = parseHexColor(
        action.erase ? '#000000' : doc.tools.penColor,
        brushOpacity(
          action.erase ? doc.tools.eraserOpacity : doc.tools.penOpacity,
          action.pressure,
          action.pointerKind,
          affect.opacity,
        ),
      );
      const radius = brushRadius(
        action.erase ? doc.tools.eraserSize : doc.tools.penSize,
        action.pressure,
        action.pointerKind,
        affect.size,
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
      const affect = pressureAffectsOf(doc.tools, action.erase);
      const hex = action.erase ? '#000000' : doc.tools.penColor;
      const baseOpacity = action.erase ? doc.tools.eraserOpacity : doc.tools.penOpacity;
      const colorFor = (pressure: number) =>
        parseHexColor(hex, brushOpacity(baseOpacity, pressure, action.pointerKind, affect.opacity));
      const radiusFor = (pressure: number) =>
        brushRadius(
          action.erase ? doc.tools.eraserSize : doc.tools.penSize,
          pressure,
          action.pointerKind,
          affect.size,
        );
      if (action.target.kind === 'page') {
        const page = doc.pages[action.target.pageId];
        if (!page) {
          return doc;
        }
        stampStroke(page.raster, action.points, radiusFor, colorFor, action.erase);
      } else {
        const inkTarget = action.target;
        if (inkTarget.kind !== 'clip') {
          return doc;
        }
        const clip = doc.pasteboardClips.find((c) => c.id === inkTarget.clipId);
        if (!clip) {
          return doc;
        }
        stampStroke(clip.raster, action.points, radiusFor, colorFor, action.erase);
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
      if (action.scaleY !== undefined) {
        clip.scaleY = action.scaleY;
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
      compositeRaster(
        page.raster,
        clip.raster,
        action.pageLocalX,
        action.pageLocalY,
        clip.scale,
        clip.rotation,
        clip.scaleY ?? clip.scale,
      );
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
        writingMode: writingModeOf(doc.tools.textWritingMode),
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
        found.node.box = fitTextBoxToContent(
          found.node.box,
          action.content,
          layoutFont,
          writingModeOf(found.node.writingMode),
        );
      }
      return doc;
    }
    case 'deleteText': {
      addTextToTrash(doc, action.textId);
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
        writingMode: writingModeOf(item.writingMode),
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
            writingMode: writingModeOf(item.writingMode),
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
        writingMode: 'vertical' as const,
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
      if (action.stockDrawerWidth !== undefined) {
        doc.stockDrawerWidth = clampStockDrawerWidth(action.stockDrawerWidth);
      }
      if (action.stockDrawerHeight !== undefined) {
        doc.stockDrawerHeight = clampStockDrawerHeight(action.stockDrawerHeight);
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
