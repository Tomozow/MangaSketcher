import type { PageId } from './types';

export type VisualSlot =
  | { kind: 'append' }
  | { kind: 'blank' }
  | { kind: 'page'; pageId: PageId; number: number };

export type SpreadPair = VisualSlot[];

export type WorkspaceLayout = {
  /** Left-to-right including + at the reading-order end (visual left). */
  ltrSlots: VisualSlot[];
  /** Spread groups looking LTR, paired from the right: [5][4] | [3][2] | [1][余白] */
  spreadsLtr: SpreadPair[];
  pageNumbers: number[];
  pageCount: number;
};

/**
 * RTL manga strip. Odd-page start places a blank at the visual right.
 * Looking LTR for 5 pages: [+] [5][4] | [3][2] | [1][余白]
 * Spreads: page 1 solo (with blank), then (2,3), (4,5)…
 */
export function layoutWorkspace(workspaceOrder: PageId[]): WorkspaceLayout {
  const pageNumbers = workspaceOrder.map((_, i) => i + 1);
  const pageSlots: VisualSlot[] = workspaceOrder.map((pageId, i) => ({
    kind: 'page',
    pageId,
    number: i + 1,
  }));
  const ltrBody: VisualSlot[] = [...pageSlots].reverse();
  ltrBody.push({ kind: 'blank' });

  const spreadsLtr: SpreadPair[] = [];
  let i = ltrBody.length;
  while (i > 0) {
    if (i >= 2) {
      spreadsLtr.unshift([ltrBody[i - 2], ltrBody[i - 1]]);
      i -= 2;
    } else {
      spreadsLtr.unshift([ltrBody[0]]);
      i = 0;
    }
  }

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
