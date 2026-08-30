import { reduceEditorDocument } from '@/src/domain/editorReducer';
import { randomId } from '@/src/storage/randomId';
import { pushEditorHistory } from '@/src/storage/history';
import { INK_IDLE_AUTOSAVE_MS, type EditorDocument, type EditorHistory, type InkUndoPixels } from '@/src/storage/types';
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

export type InkIdleAutosaveScheduler = {
  schedule(): void;
  cancel(): void;
};

export function createInkIdleAutosaveScheduler(
  run: () => void,
  delayMs = INK_IDLE_AUTOSAVE_MS,
): InkIdleAutosaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * After drawing goes idle: commit pending strokes, encode dirty rasters, write IndexedDB.
 * Does not throw if the editor is mid-teardown. Encode timeout still persists whatever PNG is ready.
 */
export async function runIdleInkAutosave(deps: EditorCheckpointDeps): Promise<void> {
  const ink = deps.ink;
  const prev = deps.getHistory();
  if (!ink || !prev) {
    return;
  }

  const drained = ink.drainPendingBakeWork(Number.POSITIVE_INFINITY, { encode: false });
  deps.pendingInkHistory.push(...drained);

  const pending = deps.pendingInkHistory.slice();
  deps.clearPendingInkHistory();
  if (pending.length === 0) {
    return;
  }

  const history = consumePendingInkHistory(prev, pending);
  deps.setHistory(history);

  const dirtyRasterIds = [...new Set(pending.map((item) => item.rasterId))];
  ink.flushPendingEncodes();
  try {
    await waitForInkEncodes((rasterId) => ink.isEncoding(rasterId), dirtyRasterIds, deps.encodeWait);
  } catch {
    // Idle save must not surface export errors; write the latest encoded PNG we have.
  }
  deps.mergeEncodedPng(ink.encodedPng);
  deps.scheduleSave(history.present, dirtyRasterIds);
  await deps.flushRouteLeave();
}
