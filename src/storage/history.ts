import { cloneEditorDocument } from './editorDocument';
import { withLiveTextSelection, withoutTextSelection } from '../domain/text';
import { HISTORY_DEPTH, type EditorDocument, type EditorHistory, type EditorHistoryEntry, type InkUndoPixels } from './types';

function cloneHistoryStackDocument(doc: EditorDocument): EditorDocument {
  return withoutTextSelection(cloneEditorDocument(doc));
}

export function createEditorHistory(doc: EditorDocument): EditorHistory {
  return {
    present: cloneEditorDocument(doc),
    past: [],
    future: [],
  };
}

export function isViewOnlyHistoryAction(actionType: string): boolean {
  return (
    actionType === 'selectPage' ||
    actionType === 'focusWorkspacePage' ||
    actionType === 'setTool' ||
    actionType === 'setToolProperties' ||
    actionType === 'setWorkspaceView' ||
    actionType === 'setStockView' ||
    actionType === 'setPdfView' ||
    actionType === 'selectClip' ||
    actionType === 'selectClips' ||
    actionType === 'selectText' ||
    actionType === 'selectTexts' ||
    actionType === 'setUiLayout'
  );
}

function cloneInkUndoPixels(value: InkUndoPixels): InkUndoPixels {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  const copy = new OffscreenCanvas(value.width, value.height);
  copy.getContext('2d')?.drawImage(value, 0, 0);
  return copy;
}

function cloneInkUndo(inkUndo: Map<string, InkUndoPixels>): Map<string, InkUndoPixels> {
  const next = new Map<string, InkUndoPixels>();
  for (const [rasterId, buffer] of inkUndo.entries()) {
    next.set(rasterId, cloneInkUndoPixels(buffer));
  }
  return next;
}

function releaseEntry(entry: EditorHistoryEntry): void {
  entry.inkUndo.clear();
}

export function pushEditorHistory(
  history: EditorHistory,
  nextPresent: EditorDocument,
  inkUndo: Map<string, InkUndoPixels>,
  viewOnly: boolean,
  maxDepth = HISTORY_DEPTH,
): EditorHistory {
  if (viewOnly) {
    return {
      present: cloneEditorDocument(nextPresent),
      past: history.past,
      future: history.future,
    };
  }
  const pastEntry: EditorHistoryEntry = {
    doc: cloneHistoryStackDocument(history.present),
    inkUndo: cloneInkUndo(inkUndo),
  };
  const past = [...history.past, pastEntry];
  const depth = Math.max(1, Math.floor(maxDepth));
  while (past.length > depth) {
    const dropped = past.shift();
    if (dropped) {
      releaseEntry(dropped);
    }
  }
  return {
    present: cloneEditorDocument(nextPresent),
    past,
    future: [],
  };
}

export function trimEditorHistoryDepth(history: EditorHistory, maxDepth: number): EditorHistory {
  const depth = Math.max(1, Math.floor(maxDepth));
  if (history.past.length <= depth) {
    return history;
  }
  const drop = history.past.length - depth;
  const kept = history.past.slice(drop);
  for (const entry of history.past.slice(0, drop)) {
    releaseEntry(entry);
  }
  return {
    present: history.present,
    past: kept,
    future: history.future,
  };
}

export type InkRestoreSink = {
  restoreRaster(rasterId: string, png: InkUndoPixels): void;
  captureRaster(rasterId: string): ArrayBuffer | undefined;
  invalidateThumb(rasterId: string): void;
};

export function undoEditorHistory(
  history: EditorHistory,
  ink: InkRestoreSink,
): EditorHistory | null {
  if (history.past.length === 0) {
    return null;
  }
  const past = [...history.past];
  const entry = past.pop();
  if (!entry) {
    return null;
  }
  const futureInkUndo = new Map<string, ArrayBuffer>();
  for (const rasterId of entry.inkUndo.keys()) {
    const current = ink.captureRaster(rasterId);
    if (current) {
      futureInkUndo.set(rasterId, current.slice(0));
    }
  }
  for (const [rasterId, png] of entry.inkUndo.entries()) {
    ink.restoreRaster(rasterId, cloneInkUndoPixels(png));
    ink.invalidateThumb(rasterId);
  }
  const futureEntry: EditorHistoryEntry = {
    doc: cloneHistoryStackDocument(history.present),
    inkUndo: futureInkUndo,
  };
  return {
    present: withLiveTextSelection(cloneEditorDocument(entry.doc), history.present),
    past,
    future: [futureEntry, ...history.future],
  };
}

export function redoEditorHistory(
  history: EditorHistory,
  ink: InkRestoreSink,
): EditorHistory | null {
  if (history.future.length === 0) {
    return null;
  }
  const future = [...history.future];
  const entry = future.shift();
  if (!entry) {
    return null;
  }
  const pastInkUndo = new Map<string, ArrayBuffer>();
  for (const rasterId of entry.inkUndo.keys()) {
    const current = ink.captureRaster(rasterId);
    if (current) {
      pastInkUndo.set(rasterId, current.slice(0));
    }
  }
  for (const [rasterId, png] of entry.inkUndo.entries()) {
    ink.restoreRaster(rasterId, cloneInkUndoPixels(png));
    ink.invalidateThumb(rasterId);
  }
  const pastEntry: EditorHistoryEntry = {
    doc: cloneHistoryStackDocument(history.present),
    inkUndo: pastInkUndo,
  };
  return {
    present: withLiveTextSelection(cloneEditorDocument(entry.doc), history.present),
    past: [...history.past, pastEntry],
    future,
  };
}
