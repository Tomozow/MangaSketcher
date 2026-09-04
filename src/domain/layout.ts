import type { PageId } from './types';

export type VisualSlot =
  | { kind: 'append' }
  | { kind: 'blank'; at?: 'start' | 'end' }
  | { kind: 'page'; pageId: PageId; number: number };

export type SpreadPair = VisualSlot[];

export type WorkspaceLayout = {
  /** Left-to-right including + at the reading-order end (visual left). */
  ltrSlots: VisualSlot[];
  /** Spread groups looking LTR: [5][4] | [3][2] | [1][余白] */
  spreadsLtr: SpreadPair[];
  pageNumbers: number[];
  pageCount: number;
};

/** Page ids in the reading spread that contains `pageId` (empty if not in order). */
export function spreadPageIdsContaining(
  workspaceOrder: readonly PageId[],
  pageId: PageId | null,
): PageId[] {
  if (pageId == null || !workspaceOrder.includes(pageId)) {
    return [];
  }
  const pair = readingSpreads([...workspaceOrder]).find((spread) =>
    spread.some((slot) => slot.kind === 'page' && slot.pageId === pageId),
  );
  if (!pair) {
    return [];
  }
  return pair
    .filter((slot): slot is Extract<VisualSlot, { kind: 'page' }> => slot.kind === 'page')
    .map((slot) => slot.pageId);
}

export function previewSpreadPageIds(
  workspaceOrder: readonly PageId[],
  selectedPageId: PageId | null,
  maxPages = 2,
): PageId[] {
  const fromSelected = spreadPageIdsContaining(workspaceOrder, selectedPageId);
  if (fromSelected.length > 0) {
    return fromSelected.slice(0, maxPages);
  }
  const first = readingSpreads([...workspaceOrder])[0];
  if (!first) {
    return [];
  }
  return first
    .filter((slot): slot is Extract<VisualSlot, { kind: 'page' }> => slot.kind === 'page')
    .map((slot) => slot.pageId)
    .slice(0, maxPages);
}

/**
 * Manga spreads from slot 0 (start blank), then real pages 1, 2, 3…
 *
 * Slot index:  0     1    2    3    4    5
 * Content:     余白  p1   p2   p3   p4   p5
 * Spread:      [--0--] [--1--] [--2--]
 *
 * Each spread is already LTR: [left page, right page].
 * Spread 0 is [1][余白]. Spread 1 is [3][2]. Never split a spread.
 */
export function readingSpreads(workspaceOrder: PageId[]): SpreadPair[] {
  const pages: VisualSlot[] = workspaceOrder.map((pageId, i) => ({
    kind: 'page',
    pageId,
    number: i + 1,
  }));
  const blank: VisualSlot = { kind: 'blank', at: 'start' };
  if (pages.length === 0) {
    return [[blank]];
  }
  const spreads: SpreadPair[] = [[pages[0]!, blank]];
  for (let i = 1; i < pages.length; i += 2) {
    const right = pages[i]!;
    const left = pages[i + 1];
    spreads.push(left ? [left, right] : [right]);
  }
  return spreads;
}

/**
 * RTL manga strip. Looking LTR for 5 pages: [+] [5][4] | [3][2] | [1][余白]
 */
export function layoutWorkspace(workspaceOrder: PageId[]): WorkspaceLayout {
  const pageNumbers = workspaceOrder.map((_, i) => i + 1);
  const reading = readingSpreads(workspaceOrder);
  const spreadsLtr = [...reading].reverse();
  const ltrBody = spreadsLtr.flat();
  return {
    ltrSlots: [{ kind: 'append' }, ...ltrBody],
    spreadsLtr,
    pageNumbers,
    pageCount: workspaceOrder.length,
  };
}

export function describeLtr(layout: WorkspaceLayout): string[] {
  return layout.ltrSlots.map((slot) => {
    if (slot.kind === 'append') {
      return '+';
    }
    if (slot.kind === 'blank') {
      return '余白';
    }
    return String(slot.number);
  });
}

export function describeSpreads(layout: WorkspaceLayout): string[] {
  return layout.spreadsLtr.map((pair) =>
    pair
      .map((slot) => {
        if (slot.kind === 'blank') {
          return '余白';
        }
        if (slot.kind === 'page') {
          return String(slot.number);
        }
        return '+';
      })
      .join('|'),
  );
}

/** Reading-order insert index (0 = before page 1) from an LTR body slot index (0 = leftmost page/blank). */
export function readingInsertIndexFromLtrBody(pageCount: number, ltrBodyIndex: number): number {
  const bodyLength = pageCount + 1;
  const fromRight = bodyLength - 1 - ltrBodyIndex;
  return Math.max(0, Math.min(pageCount, fromRight));
}
