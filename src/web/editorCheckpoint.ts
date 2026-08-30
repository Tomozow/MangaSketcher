import { reduceEditorDocument } from '@/src/domain/editorReducer';
import { randomId } from '@/src/storage/randomId';
import { pushEditorHistory } from '@/src/storage/history';
import type { EditorDocument, EditorHistory, InkUndoPixels } from '@/src/storage/types';
import { waitForInkEncodes } from '@/src/web/export/waitForInkEncode';

export type PendingInkHistoryItem = { rasterId: string; canvas: InkUndoPixels };

export function consumePendingInkHistory(
  history: EditorHistory,
  pending: PendingInkHistoryItem[],
): EditorHistory {
  let next = history;
  for (const item of pending) {
    const inkUndo = new Map<string, InkUndoPixels>([[item.rasterId, item.canvas]]);
    const nextPresent = reduceEditorDocument(next.present, { type: 'commitInkBake', rasterId: item.rasterId }, randomId);
    next = pushEditorHistory(next, nextPresent, inkUndo, false);
  }
  return next;
}

export type EditorCheckpointInk = {
  drainPendingBakeWork(maxUndo: number, options?: { encode?: boolean }): PendingInkHistoryItem[];
  flushPendingEncodes(): void;
  isEncoding(rasterId: string): boolean;
  encodedPng: ReadonlyMap<string, ArrayBuffer>;
};

export type EditorCheckpointDeps = {
  getHistory: () => EditorHistory | null;
  setHistory: (history: EditorHistory) => void;
  pendingInkHistory: PendingInkHistoryItem[];
  clearPendingInkHistory: () => void;
  ink: EditorCheckpointInk | null;
  mergeEncodedPng: (encoded: ReadonlyMap<string, ArrayBuffer>) => void;
  scheduleSave: (present: EditorDocument, dirtyRasterIds: string[]) => void;
  flushRouteLeave: () => Promise<void>;
  collectRasterIds: (doc: EditorDocument) => string[];
  encodeWait?: Parameters<typeof waitForInkEncodes>[2];
};

export async function runEditorCheckpoint(deps: EditorCheckpointDeps): Promise<void> {
  const ink = deps.ink;
  if (!ink) {
    throw new Error('Ink engine not ready');
  }

  const drained = ink.drainPendingBakeWork(Number.POSITIVE_INFINITY, { encode: false });
  deps.pendingInkHistory.push(...drained);

  const pending = deps.pendingInkHistory.slice();
  deps.clearPendingInkHistory();

  const prev = deps.getHistory();
  if (!prev) {
    throw new Error('Editor history not ready');
  }

  let history = prev;
  if (pending.length > 0) {
    history = consumePendingInkHistory(prev, pending);
    deps.setHistory(history);
  }

  const present = history.present;
  const dirtyRasterIds = deps.collectRasterIds(present);

  ink.flushPendingEncodes();
  await waitForInkEncodes((rasterId) => ink.isEncoding(rasterId), dirtyRasterIds, deps.encodeWait);
  deps.mergeEncodedPng(ink.encodedPng);
  deps.scheduleSave(present, dirtyRasterIds);
  await deps.flushRouteLeave();
}
