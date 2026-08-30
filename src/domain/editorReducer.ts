import { cloneEditorDocument, newPageMeta, type IdFactory } from './document';
import { layoutWorkspace } from './layout';
import { wrapExtractedText } from './pdfExtractPack';
import { joinVerticalBody, rangeSelectBody } from './pdfText';
import { applyFontSizeToText, resizeTextBox, selectedTextIdsOf } from './text';
import { clampSplit } from './uiLayout';
import {
  clampColumnGap,
  clampPairGap,
  clampStoredPagesPerColumn,
} from './stripGeometry';
import { clampPdfPage, keepPdfViewOnReload, pdfViewAfterLoad } from './pdfView';
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
  'setPdfExtractMarkersVisible',
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
  | { type: 'setPdfExtractMarkersVisible'; visible: boolean }
  | { type: 'setPdfExtractSanitizePunctuation'; enabled: boolean }
  | { type: 'selectClip'; clipId: ClipId | null }
  | { type: 'selectClips'; clipIds: ClipId[] }
  | { type: 'selectText'; textId: TextId | null }
  | { type: 'selectTexts'; textIds: TextId[] }
  | {
      type: 'setUiLayout';
      workspacePdfSplit?: number;
      paletteStockSplit?: number;
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
  | { type: 'deleteClip'; clipIds: ClipId[] }
  | {
      type: 'duplicateClip';
      sourceClipId: ClipId;
      clipId: ClipId;
      rasterId: string;
      x: number;
      y: number;
      scale: number;
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
  | { type: 'setPdfExtractMarkersVisible'; visible: boolean }
  | { type: 'setPdfExtractSanitizePunctuation'; enabled: boolean }
  | {
      type: 'dropPdfTextRange';
      pdfPage: number;
      range: Rect;
      attachment: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
      box: Rect;
      content?: string;
      glyphs?: Array<{ x: number; y: number; width: number; height: number }>;
      fontSize?: number;
    }
  | {
      type: 'setUiLayout';
      workspacePdfSplit?: number;
      paletteStockSplit?: number;
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

function addPageToTrash(doc: EditorDocument, pageId: PageId): void {
  if (!doc.trash.includes(pageId)) {
    doc.trash.push(pageId);
  }
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
      const item = doc.stock.find((s) => s.pageId === a.pageId);
      if (!item) {
        return doc;
      }
      doc.stock = doc.stock.filter((s) => s.pageId !== a.pageId);
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
      if (a.rotation !== undefined) {
        clip.rotation = a.rotation;
      }
      return doc;
    }
    case 'deleteClip': {
      const remove = new Set(a.clipIds);
      doc.pasteboardClips = doc.pasteboardClips.filter((c) => !remove.has(c.id));
      Object.assign(
        doc,
        clipSelection((doc.selectedClipIds ?? (doc.selectedClipId ? [doc.selectedClipId] : [])).filter((id) => !remove.has(id))),
      );
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
      }
      return doc;
    }
    case 'deleteText': {
      for (const page of Object.values(doc.pages)) {
        const index = page.texts.findIndex((t) => t.id === a.textId);
        if (index === -1) {
          continue;
        }
        page.texts.splice(index, 1);
        Object.assign(
          doc,
          textSelection(selectedTextIdsOf(doc).filter((id) => id !== a.textId)),
        );
        return doc;
      }
      const pbIndex = doc.pasteboardTexts.findIndex((t) => t.id === a.textId);
      if (pbIndex !== -1) {
        doc.pasteboardTexts.splice(pbIndex, 1);
        Object.assign(
          doc,
          textSelection(selectedTextIdsOf(doc).filter((id) => id !== a.textId)),
        );
      }
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
        extractedGlyphs: view.extractedGlyphs,
        extractMarkersVisible: view.extractMarkersVisible,
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
      const glyphs = a.glyphs ?? selected.map((item) => ({
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      }));
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
      doc.pdf.extractedGlyphs = [
        ...(doc.pdf.extractedGlyphs ?? []),
        ...glyphs.map((glyph) => ({ page: a.pdfPage, ...glyph })),
      ];
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
        ...clipSelection(action.tool !== 'select' ? [] : (state.selectedClipIds ?? (state.selectedClipId ? [state.selectedClipId] : []))),
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
    case 'setPdfExtractMarkersVisible':
      if (!state.pdf) {
        return state;
      }
      return {
        ...state,
        pdf: { ...state.pdf, extractMarkersVisible: action.visible },
      };
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
