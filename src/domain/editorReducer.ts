import { cloneEditorDocument, newPageMeta, type IdFactory } from './document';
import { layoutWorkspace } from './layout';
import { pageTextToPasteboard, wrapExtractedText, workspaceFontSizeFromTool } from './pdfExtractPack';
import { joinVerticalBody, rangeSelectBody } from './pdfText';
import { applyFontSizeToText, resizeTextBox, selectedTextIdsOf } from './text';
import { fitTextBoxToContent } from './textWrap';
import { clampSplit, clampPdfDrawerHeight, clampPdfDrawerWidth } from './uiLayout';
import {
  clampColumnGap,
  clampPairGap,
  clampStoredPagesPerColumn,
} from './stripGeometry';
import { clampPdfPage, clampPdfZoom, keepPdfViewOnReload, pdfViewAfterLoad } from './pdfView';
import { cloneStockAttachedTexts, restoreAttachedTextBoxes } from './stockClipAttach';
import { findStockClip, findStockPage, findStockText, isStockClipItem, isStockPageItem, isStockTextItem, stockedTextIds } from './stockItems';
import type {
  ClipId,
  EditorDocument,
  PageId,
  PageText,
  PasteboardText,
  PdfTextItem,
  Rect,
  StockAttachedText,
  TextId,
  ToolId,
  ToolProperties,
} from './types';
import { isSelectionTool } from './types';

const VIEW_ONLY = new Set<string>([
  'selectPage',
  'setTool',
  'setToolProperties',
  'setWorkspaceView',
  'setStockView',
  'setPdfView',
  'setPdfExtractSanitizePunctuation',
  'selectClip',
  'selectClips',
  'selectText',
  'selectTexts',
  'setUiLayout',
]);

type ViewOnlyEditorAction =
  | { type: 'selectPage'; pageId: PageId }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'setToolProperties'; patch: Partial<ToolProperties> }
  | { type: 'setWorkspaceView'; zoom: number; panX: number; panY: number }
  | { type: 'setStockView'; zoom: number; panX: number; panY: number }
  | { type: 'setPdfView'; currentPage?: number; zoom?: number; panX?: number; panY?: number }
  | { type: 'setPdfExtractSanitizePunctuation'; enabled: boolean }
  | { type: 'selectClip'; clipId: ClipId | null }
  | { type: 'selectClips'; clipIds: ClipId[] }
  | { type: 'selectText'; textId: TextId | null }
  | { type: 'selectTexts'; textIds: TextId[] }
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
  | { type: 'transformClip'; clipId: ClipId; x?: number; y?: number; scale?: number; scaleY?: number; rotation?: number }
  | { type: 'deleteClip'; clipIds: ClipId[] }
  | {
      type: 'duplicateClip';
      sourceClipId: ClipId;
      clipId: ClipId;
      rasterId: string;
      x: number;
      y: number;
      scale: number;
      scaleY?: number;
      rotation: number;
    }
  | { type: 'selectClip'; clipId: ClipId | null }
  | { type: 'selectClips'; clipIds: ClipId[] }
  | {
      type: 'createText';
      attachment: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
      box: Rect;
      content?: string;
    }
  | { type: 'editText'; textId: TextId; content: string }
  | { type: 'deleteText'; textId: TextId }
  | { type: 'deleteSelection'; textIds: TextId[]; clipIds: ClipId[] }
  | { type: 'duplicateText'; textId: TextId }
  | { type: 'moveText'; textId: TextId; x: number; y: number }
  | {
      type: 'moveSelection';
      clips: Array<{ clipId: ClipId; x: number; y: number }>;
      texts: Array<{
        textId: TextId;
        x: number;
        y: number;
        width?: number;
        height?: number;
        fontSize?: number;
        attachment?: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
      }>;
    }
  | { type: 'transferTextToPage'; textId: TextId; pageId: PageId; x: number; y: number }
  | { type: 'resizeText'; textId: TextId; box: Rect }
  | { type: 'setTextColor'; textId: TextId; color: string }
  | { type: 'setTextFontSize'; textId: TextId; fontSize: number }
  | { type: 'setTextsFontSize'; textIds: TextId[]; fontSize: number }
  | { type: 'attachTextToPage'; textId: TextId; pageId: PageId; pageBox: Rect; fontSize?: number }
  | { type: 'detachTextToPasteboard'; textId: TextId; workspaceBox: Rect; fontSize?: number }
  | { type: 'selectText'; textId: TextId | null }
  | { type: 'selectTexts'; textIds: TextId[] }
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

function textSelection(ids: TextId[]): { selectedTextId: TextId | null; selectedTextIds: TextId[] } {
  const selectedTextIds = [...new Set(ids)];
  return {
    selectedTextIds,
    selectedTextId: selectedTextIds[selectedTextIds.length - 1] ?? null,
  };
}

function clipSelection(ids: ClipId[]): { selectedClipId: ClipId | null; selectedClipIds: ClipId[] } {
  const selectedClipIds = [...new Set(ids)];
  return {
    selectedClipIds,
    selectedClipId: selectedClipIds[selectedClipIds.length - 1] ?? null,
  };
}

function selectBundledClipAndTexts(
  doc: EditorDocument,
  clipId: ClipId,
  attached: { textId: TextId }[] | undefined,
): void {
  if (!attached || attached.length === 0) {
    return;
  }
  doc.tool = 'select';
  Object.assign(doc, clipSelection([clipId]));
  Object.assign(
    doc,
    textSelection(
      attached
        .map((item) => item.textId)
        .filter((id) => doc.pasteboardTexts.some((text) => text.id === id)),
    ),
  );
}

function allTextIds(doc: EditorDocument): Set<TextId> {
  const ids = new Set<TextId>();
  for (const page of Object.values(doc.pages)) {
    for (const text of page.texts) {
      ids.add(text.id);
    }
  }
  for (const text of doc.pasteboardTexts) {
    ids.add(text.id);
  }
  return ids;
}

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

function takeEditorText(doc: EditorDocument, textId: TextId): PageText | PasteboardText | null {
  for (const page of Object.values(doc.pages)) {
    const index = page.texts.findIndex((item) => item.id === textId);
    if (index !== -1) {
      const [item] = page.texts.splice(index, 1);
      return item ?? null;
    }
  }
  const pbIndex = doc.pasteboardTexts.findIndex((item) => item.id === textId);
  if (pbIndex === -1) {
    return null;
  }
  const [item] = doc.pasteboardTexts.splice(pbIndex, 1);
  return item ?? null;
}

function ensureAttachedTextsOnPasteboard(doc: EditorDocument, attached: readonly StockAttachedText[]): void {
  for (const att of attached) {
    const found = findEditorText(doc, att.textId);
    if (!found) {
      continue;
    }
    if (found.where !== 'page') {
      continue;
    }
    const taken = takeEditorText(doc, att.textId);
    if (!taken) {
      continue;
    }
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

function putEditorText(
  doc: EditorDocument,
  node: PageText | PasteboardText,
  attachment: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' },
): boolean {
  if (attachment.kind === 'pasteboard') {
    doc.pasteboardTexts.push(node);
    return true;
  }
  const page = doc.pages[attachment.pageId];
  if (!page) {
    return false;
  }
  page.texts.push(node);
  return true;
}

function textAttachmentOf(
  found: { where: 'page' | 'pasteboard'; pageId?: PageId },
): { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' } | null {
  if (found.where === 'pasteboard') {
    return { kind: 'pasteboard' };
  }
  return found.pageId ? { kind: 'page', pageId: found.pageId } : null;
}

function sameTextAttachment(
  found: { where: 'page' | 'pasteboard'; pageId?: PageId },
  attachment: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' } | undefined,
): boolean {
  if (!attachment) {
    return true;
  }
  if (attachment.kind === 'pasteboard') {
    return found.where === 'pasteboard';
  }
  return found.where === 'page' && found.pageId === attachment.pageId;
}

function removeTextsById(doc: EditorDocument, textIds: TextId[]): void {
  const remove = new Set(textIds);
  if (remove.size === 0) {
    return;
  }
  for (const page of Object.values(doc.pages)) {
    page.texts = page.texts.filter((t) => !remove.has(t.id));
  }
  doc.pasteboardTexts = doc.pasteboardTexts.filter((t) => !remove.has(t.id));
  doc.stock = doc.stock.filter((item) => !(isStockTextItem(item) && remove.has(item.textId)));
  Object.assign(
    doc,
    textSelection(selectedTextIdsOf(doc).filter((id) => !remove.has(id))),
  );
}

function removeClipsById(doc: EditorDocument, clipIds: ClipId[]): void {
  const remove = new Set(clipIds);
  if (remove.size === 0) {
    return;
  }
  doc.pasteboardClips = doc.pasteboardClips.filter((c) => !remove.has(c.id));
  doc.stock = doc.stock.filter((item) => !(isStockClipItem(item) && remove.has(item.clipId)));
  Object.assign(
    doc,
    clipSelection(
      (doc.selectedClipIds ?? (doc.selectedClipId ? [doc.selectedClipId] : [])).filter(
        (id) => !remove.has(id),
      ),
    ),
  );
}

function addPageToTrash(doc: EditorDocument, pageId: PageId): void {
  if (!doc.trash.includes(pageId)) {
    doc.trash.push(pageId);
  }
}

function ensureTrashLists(doc: EditorDocument): void {
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

function stashClipAttachedTexts(doc: EditorDocument, clipId: ClipId, attached: StockAttachedText[] | undefined): void {
  ensureTrashLists(doc);
  if (!attached || attached.length === 0) {
    delete doc.trashClipAttachedTexts![clipId];
    return;
  }
  doc.trashClipAttachedTexts![clipId] = cloneStockAttachedTexts(attached) ?? [];
}

function addClipToTrash(doc: EditorDocument, clipId: ClipId): void {
  ensureTrashLists(doc);
  if (!doc.pasteboardClips.some((clip) => clip.id === clipId)) {
    return;
  }
  const stocked = findStockClip(doc.stock, clipId);
  stashClipAttachedTexts(doc, clipId, stocked?.attachedTexts);
  doc.stock = doc.stock.filter((item) => !(isStockClipItem(item) && item.clipId === clipId));
  if (!doc.trashClips.includes(clipId)) {
    doc.trashClips.push(clipId);
  }
  Object.assign(
    doc,
    clipSelection(
      (doc.selectedClipIds ?? (doc.selectedClipId ? [doc.selectedClipId] : [])).filter((id) => id !== clipId),
    ),
  );
}

function addTextToTrash(doc: EditorDocument, textId: TextId): void {
  ensureTrashLists(doc);
  const found = findEditorText(doc, textId);
  if (!found) {
    return;
  }
  if (found.where === 'page') {
    const taken = takeEditorText(doc, textId);
    if (!taken) {
      return;
    }
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
  doc.stock = doc.stock.filter((item) => !(isStockTextItem(item) && item.textId === textId));
  if (!doc.trashTexts.includes(textId)) {
    doc.trashTexts.push(textId);
  }
  Object.assign(doc, textSelection(selectedTextIdsOf(doc).filter((id) => id !== textId)));
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
      addPageToTrash(doc, a.pageId);
      return doc;
    }
    case 'deleteStockPage': {
      const item = findStockPage(doc.stock, a.pageId);
      if (!item) {
        return doc;
      }
      doc.stock = doc.stock.filter((s) => !isStockPageItem(s) || s.pageId !== a.pageId);
      addPageToTrash(doc, a.pageId);
      return doc;
    }
    case 'returnTrashToWorkspace': {
      const idx = doc.trash.indexOf(a.pageId);
      if (idx === -1) {
        return doc;
      }
      doc.trash.splice(idx, 1);
      const insertAt = Math.max(0, Math.min(doc.workspaceOrder.length, a.readingIndex));
      doc.workspaceOrder.splice(insertAt, 0, a.pageId);
      doc.selectedPageId = a.pageId;
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
      const clipIds = [...doc.trashClips];
      const bundledTextIds = Object.values(doc.trashClipAttachedTexts ?? {}).flatMap((texts) =>
        texts.map((item) => item.textId),
      );
      const textIds = [...new Set([...doc.trashTexts, ...bundledTextIds])];
      doc.trash = [];
      doc.trashClips = [];
      doc.trashTexts = [];
      doc.trashClipAttachedTexts = {};
      removeClipsById(doc, clipIds);
      removeTextsById(doc, textIds);
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
    case 'reorderStock': {
      const { fromIndex, toIndex } = a;
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
      const { fromIndex, toIndex } = a;
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
      if (!doc.workspaceOrder.includes(a.pageId)) {
        return doc;
      }
      removePageFromWorkspace(doc, a.pageId);
      doc.stock.push({ pageId: a.pageId, x: a.x, y: a.y });
      return doc;
    }
    case 'returnStockToWorkspace': {
      const idx = doc.stock.findIndex((s) => isStockPageItem(s) && s.pageId === a.pageId);
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
      const item = findStockPage(doc.stock, a.pageId);
      if (!item) {
        return doc;
      }
      item.x = a.x;
      item.y = a.y;
      return doc;
    }
    case 'moveClipToStock': {
      if (!doc.pasteboardClips.some((clip) => clip.id === a.clipId)) {
        return doc;
      }
      if (findStockClip(doc.stock, a.clipId)) {
        return doc;
      }
      const attached = cloneStockAttachedTexts(a.attachedTexts) ?? [];
      ensureAttachedTextsOnPasteboard(doc, attached);
      doc.stock.push({
        kind: 'clip',
        clipId: a.clipId,
        x: a.x,
        y: a.y,
        attachedTexts: attached.length > 0 ? attached : undefined,
      });
      Object.assign(
        doc,
        clipSelection(
          (doc.selectedClipIds ?? (doc.selectedClipId ? [doc.selectedClipId] : [])).filter(
            (id) => id !== a.clipId,
          ),
        ),
      );
      if (attached.length > 0) {
        const hide = new Set(attached.map((item) => item.textId));
        Object.assign(
          doc,
          textSelection(selectedTextIdsOf(doc).filter((id) => !hide.has(id))),
        );
      }
      return doc;
    }
    case 'moveTextToStock': {
      const found = findEditorText(doc, a.textId);
      if (!found) {
        return doc;
      }
      if (findStockText(doc.stock, a.textId) || stockedTextIds(doc.stock).has(a.textId)) {
        return doc;
      }
      if (found.where === 'page') {
        const taken = takeEditorText(doc, a.textId);
        if (!taken) {
          return doc;
        }
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
      doc.stock.push({ kind: 'text', textId: a.textId, x: a.x, y: a.y });
      Object.assign(
        doc,
        textSelection(selectedTextIdsOf(doc).filter((id) => id !== a.textId)),
      );
      return doc;
    }
    case 'returnStockClip': {
      const idx = doc.stock.findIndex((s) => isStockClipItem(s) && s.clipId === a.clipId);
      if (idx === -1) {
        return doc;
      }
      const [removed] = doc.stock.splice(idx, 1);
      const clip = doc.pasteboardClips.find((c) => c.id === a.clipId);
      if (clip) {
        clip.x = a.x;
        clip.y = a.y;
      }
      restoreAttachedTextBoxes(doc.pasteboardTexts, a.x, a.y, removed && isStockClipItem(removed) ? removed.attachedTexts : undefined);
      selectBundledClipAndTexts(
        doc,
        a.clipId,
        removed && isStockClipItem(removed) ? removed.attachedTexts : undefined,
      );
      return doc;
    }
    case 'returnStockText': {
      const idx = doc.stock.findIndex((s) => isStockTextItem(s) && s.textId === a.textId);
      if (idx === -1) {
        return doc;
      }
      doc.stock.splice(idx, 1);
      const text = doc.pasteboardTexts.find((t) => t.id === a.textId);
      if (text) {
        text.box = { ...text.box, x: a.x, y: a.y };
      }
      return doc;
    }
    case 'returnTrashClip': {
      ensureTrashLists(doc);
      const idx = doc.trashClips.indexOf(a.clipId);
      if (idx === -1) {
        return doc;
      }
      doc.trashClips.splice(idx, 1);
      const attached = doc.trashClipAttachedTexts?.[a.clipId];
      if (doc.trashClipAttachedTexts) {
        delete doc.trashClipAttachedTexts[a.clipId];
      }
      const clip = doc.pasteboardClips.find((c) => c.id === a.clipId);
      if (clip) {
        clip.x = a.x;
        clip.y = a.y;
      }
      restoreAttachedTextBoxes(doc.pasteboardTexts, a.x, a.y, attached);
      selectBundledClipAndTexts(doc, a.clipId, attached);
      return doc;
    }
    case 'returnTrashText': {
      ensureTrashLists(doc);
      const idx = doc.trashTexts.indexOf(a.textId);
      if (idx === -1) {
        return doc;
      }
      doc.trashTexts.splice(idx, 1);
      const text = doc.pasteboardTexts.find((t) => t.id === a.textId);
      if (text) {
        text.box = { ...text.box, x: a.x, y: a.y };
      }
      return doc;
    }
    case 'placeStockClip': {
      const item = findStockClip(doc.stock, a.clipId);
      if (!item) {
        return doc;
      }
      item.x = a.x;
      item.y = a.y;
      return doc;
    }
    case 'placeStockText': {
      const item = findStockText(doc.stock, a.textId);
      if (!item) {
        return doc;
      }
      item.x = a.x;
      item.y = a.y;
      return doc;
    }
    case 'deleteStockClip': {
      addClipToTrash(doc, a.clipId);
      return doc;
    }
    case 'deleteStockText': {
      addTextToTrash(doc, a.textId);
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
      Object.assign(doc, clipSelection([a.clipId]));
      Object.assign(doc, textSelection([]));
      return doc;
    }
    case 'commitClipBake': {
      const clipIndex = doc.pasteboardClips.findIndex((c) => c.id === a.clipId);
      if (clipIndex === -1 || !doc.pages[a.pageId]) {
        return doc;
      }
      doc.pasteboardClips.splice(clipIndex, 1);
      Object.assign(
        doc,
        clipSelection((doc.selectedClipIds ?? (doc.selectedClipId ? [doc.selectedClipId] : [])).filter((id) => id !== a.clipId)),
      );
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
      if (a.scaleY !== undefined) {
        clip.scaleY = a.scaleY;
      }
      if (a.rotation !== undefined) {
        clip.rotation = a.rotation;
      }
      return doc;
    }
    case 'deleteClip': {
      for (const clipId of a.clipIds) {
        addClipToTrash(doc, clipId);
      }
      return doc;
    }
    case 'deleteSelection': {
      for (const textId of a.textIds) {
        addTextToTrash(doc, textId);
      }
      for (const clipId of a.clipIds) {
        addClipToTrash(doc, clipId);
      }
      return doc;
    }
    case 'duplicateClip': {
      const source = doc.pasteboardClips.find((c) => c.id === a.sourceClipId);
      if (!source) {
        return doc;
      }
      doc.pasteboardClips.push({
        id: a.clipId,
        rasterId: a.rasterId,
        x: a.x,
        y: a.y,
        scale: a.scale,
        scaleY: a.scaleY ?? a.scale,
        rotation: a.rotation,
      });
      Object.assign(doc, clipSelection([a.clipId]));
      Object.assign(doc, textSelection([]));
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
      Object.assign(doc, textSelection([id]));
      return doc;
    }
    case 'editText': {
      const found = findEditorText(doc, a.textId);
      if (found) {
        found.node.content = a.content;
        const layoutFont =
          found.where === 'pasteboard'
            ? workspaceFontSizeFromTool(found.node.fontSize, doc.rasterWidth)
            : found.node.fontSize;
        found.node.box = fitTextBoxToContent(found.node.box, a.content, layoutFont);
      }
      return doc;
    }
    case 'deleteText': {
      addTextToTrash(doc, a.textId);
      return doc;
    }
    case 'duplicateText': {
      const found = findEditorText(doc, a.textId);
      if (!found) {
        return doc;
      }
      const id = ids();
      const offset = found.where === 'pasteboard' ? 16 : 32;
      const clone = {
        id,
        content: found.node.content,
        box: {
          ...found.node.box,
          x: found.node.box.x + offset,
          y: found.node.box.y + offset,
        },
        fontSize: found.node.fontSize,
        color: found.node.color,
      };
      if (found.where === 'page' && found.pageId) {
        doc.pages[found.pageId]?.texts.push(clone);
      } else {
        doc.pasteboardTexts.push(clone);
      }
      Object.assign(doc, textSelection([id]));
      return doc;
    }
    case 'moveText': {
      const found = findEditorText(doc, a.textId);
      if (found && Number.isFinite(a.x) && Number.isFinite(a.y)) {
        found.node.box.x = a.x;
        found.node.box.y = a.y;
      }
      return doc;
    }
    case 'moveSelection': {
      for (const clipMove of a.clips) {
        const clip = doc.pasteboardClips.find((item) => item.id === clipMove.clipId);
        if (!clip || !Number.isFinite(clipMove.x) || !Number.isFinite(clipMove.y)) {
          continue;
        }
        clip.x = clipMove.x;
        clip.y = clipMove.y;
      }
      for (const textMove of a.texts) {
        const found = findEditorText(doc, textMove.textId);
        if (!found || !Number.isFinite(textMove.x) || !Number.isFinite(textMove.y)) {
          continue;
        }
        const nextBox = {
          ...found.node.box,
          x: textMove.x,
          y: textMove.y,
          ...(Number.isFinite(textMove.width) ? { width: textMove.width as number } : {}),
          ...(Number.isFinite(textMove.height) ? { height: textMove.height as number } : {}),
        };
        const nextFontSize = Number.isFinite(textMove.fontSize) ? (textMove.fontSize as number) : found.node.fontSize;
        if (sameTextAttachment(found, textMove.attachment)) {
          found.node.box = nextBox;
          found.node.fontSize = nextFontSize;
          continue;
        }
        const home = textAttachmentOf(found);
        const taken = takeEditorText(doc, textMove.textId);
        if (!taken || !home) {
          continue;
        }
        taken.box = nextBox;
        taken.fontSize = nextFontSize;
        if (!putEditorText(doc, taken, textMove.attachment!)) {
          putEditorText(doc, taken, home);
        }
      }
      return doc;
    }
    case 'transferTextToPage': {
      const target = doc.pages[a.pageId];
      if (!target) {
        return doc;
      }
      for (const page of Object.values(doc.pages)) {
        const index = page.texts.findIndex((t) => t.id === a.textId);
        if (index === -1) {
          continue;
        }
        if (page.id === a.pageId) {
          const item = page.texts[index]!;
          item.box.x = a.x;
          item.box.y = a.y;
          return doc;
        }
        const [item] = page.texts.splice(index, 1);
        target.texts.push({
          ...item,
          box: { ...item.box, x: a.x, y: a.y },
        });
        return doc;
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
    case 'setTextsFontSize': {
      for (const textId of a.textIds) {
        const found = findEditorText(doc, textId);
        if (!found) {
          continue;
        }
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
        fontSize: a.fontSize ?? item.fontSize,
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
            fontSize: a.fontSize ?? item.fontSize,
            color: item.color,
          });
          break;
        }
      }
      return doc;
    }
    case 'loadPdf': {
      const view = pdfViewAfterLoad(doc.pdf, {
        opfsPath: a.opfsPath,
        pageCount: a.pageCount,
        fingerprint: a.sourceFingerprint,
      });
      const sameSource = keepPdfViewOnReload(doc.pdf, { opfsPath: a.opfsPath, fingerprint: a.sourceFingerprint });
      doc.pdf = {
        opfsPath: a.opfsPath,
        pageCount: a.pageCount,
        currentPage: view.currentPage,
        zoom: view.zoom,
        panX: view.panX,
        panY: view.panY,
        sourceTextByPage: a.sourceTextByPage,
        generation: a.generation ?? (sameSource ? doc.pdf!.generation : 1),
        sourceFingerprint: a.sourceFingerprint ?? (sameSource ? doc.pdf?.sourceFingerprint : undefined),
        extractSanitizePunctuation: view.extractSanitizePunctuation,
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
      const content = wrapExtractedText(a.content ?? joinVerticalBody(selected));
      const id = ids();
      const text = {
        id,
        content,
        box: { ...a.box },
        fontSize: a.fontSize ?? doc.tools.textFontSize,
        color: doc.tools.textColor,
      };
      if (a.attachment.kind === 'page') {
        doc.pages[a.attachment.pageId]?.texts.push(text);
      } else {
        doc.pasteboardTexts.push(text);
      }
      Object.assign(doc, textSelection([id]));
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
        return { ...state, selectedPageId: action.pageId, ...clipSelection([]), ...textSelection([]) };
      }
      return state;
    case 'setTool':
      return {
        ...state,
        tool: action.tool,
        ...clipSelection(isSelectionTool(action.tool) ? (state.selectedClipIds ?? (state.selectedClipId ? [state.selectedClipId] : [])) : []),
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
        pdf.zoom = clampPdfZoom(action.zoom);
      }
      if (action.panX !== undefined) {
        pdf.panX = action.panX;
      }
      if (action.panY !== undefined) {
        pdf.panY = action.panY;
      }
      return { ...state, pdf };
    case 'setPdfExtractSanitizePunctuation':
      if (!state.pdf) {
        return state;
      }
      return {
        ...state,
        pdf: { ...state.pdf, extractSanitizePunctuation: action.enabled },
      };
    case 'selectClip':
      return {
        ...state,
        ...clipSelection(action.clipId ? [action.clipId] : []),
        ...(action.clipId ? textSelection([]) : {}),
      };
    case 'selectClips': {
      const existing = new Set(state.pasteboardClips.map((c) => c.id));
      return {
        ...state,
        ...clipSelection(action.clipIds.filter((id) => existing.has(id))),
      };
    }
    case 'selectText':
      return {
        ...state,
        ...textSelection(action.textId ? [action.textId] : []),
        ...(action.textId ? clipSelection([]) : {}),
      };
    case 'selectTexts': {
      const existingTexts = allTextIds(state);
      return {
        ...state,
        ...textSelection(action.textIds.filter((id) => existingTexts.has(id))),
      };
    }
    case 'setUiLayout': {
      const patch: Partial<EditorDocument> = {};
      if (action.workspacePdfSplit !== undefined) {
        patch.workspacePdfSplit = clampSplit(action.workspacePdfSplit);
      }
      if (action.paletteStockSplit !== undefined) {
        patch.paletteStockSplit = clampSplit(action.paletteStockSplit);
      }
      if (action.pdfDrawerWidth !== undefined) {
        patch.pdfDrawerWidth = clampPdfDrawerWidth(action.pdfDrawerWidth);
      }
      if (action.pdfDrawerHeight !== undefined) {
        patch.pdfDrawerHeight = clampPdfDrawerHeight(action.pdfDrawerHeight);
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
      if (action.stockPane !== undefined) {
        patch.stockPane = action.stockPane === 'trash' ? 'trash' : 'stock';
      }
      if (action.pagesPerColumn !== undefined) {
        patch.pagesPerColumn = clampStoredPagesPerColumn(action.pagesPerColumn);
      }
      if (action.pairGap !== undefined) {
        patch.pairGap = clampPairGap(action.pairGap);
      }
      if (action.showPairDivider !== undefined) {
        patch.showPairDivider = action.showPairDivider;
      }
      if (action.columnGap !== undefined) {
        patch.columnGap = clampColumnGap(action.columnGap);
      }
      return { ...state, ...patch };
    }
    default:
      return state;
  }
}

export { layoutWorkspace };
