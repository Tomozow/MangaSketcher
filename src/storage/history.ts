import { cloneEditorDocument } from './editorDocument';
import { HISTORY_DEPTH, type EditorDocument, type EditorHistory, type EditorHistoryEntry } from './types';

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
    actionType === 'setTool' ||
    actionType === 'setToolProperties' ||
    actionType === 'setWorkspaceView' ||
    actionType === 'setStockView' ||
    actionType === 'setPdfView' ||
    actionType === 'selectClip' ||
    actionType === 'selectText' ||
    actionType === 'setUiLayout'
  );
}

function cloneInkUndo(inkUndo: Map<string, ArrayBuffer>): Map<string, ArrayBuffer> {
  const next = new Map<string, ArrayBuffer>();
  for (const [rasterId, buffer] of inkUndo.entries()) {
    next.set(rasterId, buffer.slice(0));
  }
  return next;
}

function releaseEntry(entry: EditorHistoryEntry): void {
  entry.inkUndo.clear();
}

export function pushEditorHistory(
  history: EditorHistory,
  nextPresent: EditorDocument,
  inkUndo: Map<string, ArrayBuffer>,
  viewOnly: boolean,
): EditorHistory {
  if (viewOnly) {
    return {
      present: cloneEditorDocument(nextPresent),
      past: history.past,
      future: [],
    };
  }
  const pastEntry: EditorHistoryEntry = {
    doc: cloneEditorDocument(history.present),
    inkUndo: cloneInkUndo(inkUndo),
  };
  const past = [...history.past, pastEntry];
  while (past.length > HISTORY_DEPTH) {
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

export type InkRestoreSink = {
  restoreRaster(rasterId: string, png: ArrayBuffer): void;
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
    ink.restoreRaster(rasterId, png.slice(0));
    ink.invalidateThumb(rasterId);
  }
  const futureEntry: EditorHistoryEntry = {
    doc: cloneEditorDocument(history.present),
    inkUndo: futureInkUndo,
  };
  return {
    present: cloneEditorDocument(entry.doc),
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
    ink.restoreRaster(rasterId, png.slice(0));
    ink.invalidateThumb(rasterId);
  }
  const pastEntry: EditorHistoryEntry = {
    doc: cloneEditorDocument(history.present),
    inkUndo: pastInkUndo,
  };
  return {
    present: cloneEditorDocument(entry.doc),
    past: [...history.past, pastEntry],
    future,
  };
}
