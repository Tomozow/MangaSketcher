import type { ClipId, PageId, StockAttachedText, StockItem, TextId } from './types';
import { cloneStockAttachedTexts } from './stockClipAttach';

export type StockPageItem = { kind?: 'page'; pageId: PageId; x: number; y: number };
export type StockClipItem = { kind: 'clip'; clipId: ClipId; x: number; y: number };
export type StockTextItem = { kind: 'text'; textId: TextId; x: number; y: number };

export function isStockPageItem(item: StockItem): item is StockPageItem {
  return item.kind !== 'clip' && item.kind !== 'text' && Boolean(item.pageId);
}

export function isStockClipItem(item: StockItem): item is StockClipItem {
  return item.kind === 'clip';
}

export function isStockTextItem(item: StockItem): item is StockTextItem {
  return item.kind === 'text';
}

export type StockGridCell = {
  column: number;
  row: 1 | 2;
  rowSpan: 1 | 2;
};

/**
 * 2-row grid: array[0] is top-right (front), then bottom-right, then the column to the left.
 * The last array item sits on the left. Pages, clips, and texts are one row each.
 * Adjacent items share a column (earlier index on top). An unpaired item sits on top.
 */
export function stockGridPlacements(items: readonly StockItem[]): StockGridCell[] {
  const cells: StockGridCell[] = items.map(() => ({ column: 1, row: 1, rowSpan: 1 }));
  type Col = { top: number; bottom?: number };
  const fromRight: Col[] = [];
  let i = 0;
  while (i < items.length) {
    if (i + 1 < items.length) {
      fromRight.push({ top: i, bottom: i + 1 });
      i += 2;
      continue;
    }
    fromRight.push({ top: i });
    i += 1;
  }
  fromRight.reverse().forEach((col, offset) => {
    const column = offset + 1;
    cells[col.top] = { column, row: 1, rowSpan: 1 };
    if (col.bottom !== undefined) {
      cells[col.bottom] = { column, row: 2, rowSpan: 1 };
    }
  });
  return cells;
}

/** Page-width units for a fitted stock dock (each column is half a page). */
export function stockGridFitPageUnits(items: readonly StockItem[]): number {
  const placements = stockGridPlacements(items);
  let maxCol = 0;
  for (const cell of placements) {
    maxCol = Math.max(maxCol, cell.column);
  }
  return maxCol * 0.5;
}

/** Grid packs to the right: pages first (left), clips/texts in front (right). */
export function stockPagesThenForeground<T extends StockItem>(stock: readonly T[]): T[] {
  const pages: T[] = [];
  const foreground: T[] = [];
  for (const item of stock) {
    if (isStockPageItem(item)) {
      pages.push(item);
    } else {
      foreground.push(item);
    }
  }
  return [...pages, ...foreground];
}

export function stockedClipIds(stock: readonly StockItem[]): Set<ClipId> {
  const ids = new Set<ClipId>();
  for (const item of stock) {
    if (isStockClipItem(item)) {
      ids.add(item.clipId);
    }
  }
  return ids;
}

export function cloneStockItem(item: StockItem): StockItem {
  return {
    ...item,
    attachedTexts: cloneStockAttachedTexts(item.attachedTexts),
  };
}

export function cloneTrashClipAttachedTexts(
  map: Record<string, StockAttachedText[]> | undefined,
): Record<string, StockAttachedText[]> | undefined {
  if (!map) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(map).map(([clipId, texts]) => [clipId, cloneStockAttachedTexts(texts) ?? []]),
  );
}

export function stockedTextIds(
  stock: readonly StockItem[],
  trashClipAttachedTexts?: Record<string, StockAttachedText[]>,
): Set<TextId> {
  const ids = new Set<TextId>();
  for (const item of stock) {
    if (isStockTextItem(item)) {
      ids.add(item.textId);
    }
    if (isStockClipItem(item)) {
      for (const attached of item.attachedTexts ?? []) {
        ids.add(attached.textId);
      }
    }
  }
  if (trashClipAttachedTexts) {
    for (const texts of Object.values(trashClipAttachedTexts)) {
      for (const attached of texts) {
        ids.add(attached.textId);
      }
    }
  }
  return ids;
}

export function findStockClip(stock: readonly StockItem[], clipId: ClipId): StockClipItem | undefined {
  return stock.find((item): item is StockClipItem => isStockClipItem(item) && item.clipId === clipId);
}

export function findStockText(stock: readonly StockItem[], textId: TextId): StockTextItem | undefined {
  return stock.find((item): item is StockTextItem => isStockTextItem(item) && item.textId === textId);
}

export function findStockPage(stock: readonly StockItem[], pageId: PageId): StockPageItem | undefined {
  return stock.find((item): item is StockPageItem => isStockPageItem(item) && item.pageId === pageId);
}

export function stockThumbKey(item: StockItem): string {
  if (isStockClipItem(item)) {
    return `clip:${item.clipId}`;
  }
  if (isStockTextItem(item)) {
    return `text:${item.textId}`;
  }
  return item.pageId ?? '';
}

export function stockIndexByKey(stock: readonly StockItem[], key: string): number {
  return stock.findIndex((item) => stockThumbKey(item) === key);
}

export function parseStockThumbKey(
  key: string,
): { kind: 'page'; pageId: PageId } | { kind: 'clip'; clipId: ClipId } | { kind: 'text'; textId: TextId } | null {
  if (key.startsWith('clip:')) {
    return { kind: 'clip', clipId: key.slice(5) };
  }
  if (key.startsWith('text:')) {
    return { kind: 'text', textId: key.slice(5) };
  }
  if (key.length > 0) {
    return { kind: 'page', pageId: key };
  }
  return null;
}

export function withoutStockedClips<T extends { id: ClipId }>(
  clips: readonly T[],
  stock: readonly StockItem[],
  trashClips: readonly ClipId[] = [],
): T[] {
  const hidden = stockedClipIds(stock);
  for (const id of trashClips) {
    hidden.add(id);
  }
  if (hidden.size === 0) {
    return [...clips];
  }
  return clips.filter((clip) => !hidden.has(clip.id));
}

export function withoutStockedTexts<T extends { id: TextId }>(
  texts: readonly T[],
  stock: readonly StockItem[],
  trashTexts: readonly TextId[] = [],
  trashClipAttachedTexts?: Record<string, StockAttachedText[]>,
): T[] {
  const hidden = stockedTextIds(stock, trashClipAttachedTexts);
  for (const id of trashTexts) {
    hidden.add(id);
  }
  if (hidden.size === 0) {
    return [...texts];
  }
  return texts.filter((text) => !hidden.has(text.id));
}
