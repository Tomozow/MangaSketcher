import { dropActions } from '../../domain/drop';
import type { EditorDocumentAction } from '../../domain/editorReducer';
import { pageLocalFromWorld, type StripFrame } from '../../domain/stripGeometry';
import { clampTextBoxOrigin } from '../../domain/text';
import { isStockPageItem } from '../../domain/stockItems';
import type { PageId, Rect, StockItem } from '../../domain/types';
import { textBoxForOwnerMove, textOwnerAtWorld } from '../gestures/elementInteraction';

const FREE_STOCK_PAGE_W = 144;
const FREE_STOCK_PAGE_H = 204;
const FREE_STOCK_GAP = 8;
const FREE_STOCK_COLS = 4;

export function nextFreeStockPagePosition(stock: readonly StockItem[]): { x: number; y: number } {
  const count = stock.filter(isStockPageItem).length;
  const col = count % FREE_STOCK_COLS;
  const row = Math.floor(count / FREE_STOCK_COLS);
  return {
    x: FREE_STOCK_GAP + col * (FREE_STOCK_PAGE_W + FREE_STOCK_GAP),
    y: FREE_STOCK_GAP + row * (FREE_STOCK_PAGE_H + FREE_STOCK_GAP),
  };
}

export function moveWorkspacePageToStock(
  pageId: PageId,
  fromIndex: number,
  x: number,
  y: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'workspacePage', pageId, fromIndex },
    { zone: 'stock', x, y },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}

export function returnStockPageToWorkspace(
  pageId: PageId,
  readingIndex: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'stockPage', pageId },
    { zone: 'workspaceInsert', readingIndex },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}

export function returnTrashPageToWorkspace(
  pageId: PageId,
  readingIndex: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'trashPage', pageId },
    { zone: 'workspaceInsert', readingIndex },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}

export function dropWorkspacePageToTrash(pageId: PageId): EditorDocumentAction[] {
  return dropActions(
    { type: 'workspacePage', pageId, fromIndex: 0 },
    { zone: 'trash' },
    1,
    1,
  ) as EditorDocumentAction[];
}

export function dropStockPageToTrash(pageId: PageId): EditorDocumentAction[] {
  return dropActions({ type: 'stockPage', pageId }, { zone: 'trash' }, 1, 1) as EditorDocumentAction[];
}

export function moveClipToStock(
  clipId: string,
  x: number,
  y: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'clip', clipId },
    { zone: 'stock', x, y },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}

export function moveTextToStock(
  textId: string,
  x: number,
  y: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'pasteboardText', textId },
    { zone: 'stock', x, y },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}

export function placeStockPage(
  pageId: PageId,
  x: number,
  y: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'stockPage', pageId },
    { zone: 'stock', x, y },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}

export function returnStockTextToWorkspace(input: {
  textId: string;
  pointerWorldX: number;
  pointerWorldY: number;
  box: Rect;
  fontSize: number;
  frames: StripFrame[];
  rasterWidth: number;
  rasterHeight: number;
  fromTrash?: boolean;
}): EditorDocumentAction[] {
  const dropX = input.pointerWorldX - input.box.width / 2;
  const dropY = input.pointerWorldY - input.box.height / 2;
  const unstock: EditorDocumentAction = input.fromTrash
    ? { type: 'returnTrashText', textId: input.textId, x: dropX, y: dropY }
    : { type: 'returnStockText', textId: input.textId, x: dropX, y: dropY };
  const owner = textOwnerAtWorld(input.frames, input.pointerWorldX, input.pointerWorldY);
  if (owner.kind !== 'page') {
    return [unstock];
  }
  const frame = input.frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === owner.pageId);
  if (!frame) {
    return [unstock];
  }
  const local = pageLocalFromWorld(frame, dropX, dropY, input.rasterWidth, input.rasterHeight);
  const pageBox = textBoxForOwnerMove({
    sourceWhere: 'pasteboard',
    sourceBox: input.box,
    x: local.x,
    y: local.y,
    targetPageId: owner.pageId,
    frameForPageId: (pageId) =>
      input.frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === pageId) ?? null,
    rasterWidth: input.rasterWidth,
    rasterHeight: input.rasterHeight,
  });
  const origin = clampTextBoxOrigin(
    pageBox.x,
    pageBox.y,
    pageBox.width,
    pageBox.height,
    input.rasterWidth,
    input.rasterHeight,
  );
  return [
    unstock,
    {
      type: 'attachTextToPage',
      textId: input.textId,
      pageId: owner.pageId,
      pageBox: { ...pageBox, ...origin },
      fontSize: input.fontSize,
    },
  ];
}