import { cloneDocument, cloneEditorDocument, type IdFactory } from './document';
import { reduceTestDocument, type DocumentAction } from './reducer';
import { reduceEditorDocument, type EditorDocumentAction } from './editorReducer';
import type { EditorHistoryState, HistoryState } from './types';

const VIEW_ONLY = new Set([
  'selectPage',
  'setTool',
  'setToolProperties',
  'setWorkspaceView',
  'setStockView',
  'setPdfView',
  'setPdfExtractMarkersVisible',
  'selectClip',
  'selectText',
  'setUiLayout',
]);

export const HISTORY_DEPTH = 50;

export function createHistory(present: HistoryState['present']): HistoryState {
  return { present, past: [], future: [] };
}

export function createEditorHistory(present: EditorHistoryState['present']): EditorHistoryState {
  return { present, past: [], future: [] };
}

export function reduceHistory(
  history: HistoryState,
  action: DocumentAction | { type: 'undo' } | { type: 'redo' },
  ids: IdFactory,
): HistoryState {
  if (action.type === 'undo') {
    if (history.past.length === 0) {
      return history;
    }
    const past = [...history.past];
    const present = past.pop()!;
    return {
      present,
      past,
      future: [cloneDocument(history.present), ...history.future],
    };
  }
  if (action.type === 'redo') {
    if (history.future.length === 0) {
      return history;
    }
    const [next, ...future] = history.future;
    return {
      present: next,
      past: [...history.past, cloneDocument(history.present)],
      future,
    };
  }
  const next = reduceTestDocument(history.present, action, ids);
  if (VIEW_ONLY.has(action.type)) {
    return { ...history, present: next };
  }
  return {
    present: next,
    past: [...history.past, cloneDocument(history.present)],
    future: [],
  };
}

export function reduceEditorHistory(
  history: EditorHistoryState,
  action: EditorDocumentAction | { type: 'undo' } | { type: 'redo' },
  ids: IdFactory,
): EditorHistoryState {
  if (action.type === 'undo') {
    if (history.past.length === 0) {
      return history;
    }
    const past = [...history.past];
    const entry = past.pop()!;
    return {
      present: entry.doc,
      past,
      future: [
        { doc: cloneEditorDocument(history.present), inkUndo: {} },
        ...history.future,
      ],
    };
  }
  if (action.type === 'redo') {
    if (history.future.length === 0) {
      return history;
    }
    const [entry, ...future] = history.future;
    return {
      present: entry.doc,
      past: [
        ...history.past,
        { doc: cloneEditorDocument(history.present), inkUndo: {} },
      ],
      future,
    };
  }

  const next = reduceEditorDocument(history.present, action, ids);
  if (VIEW_ONLY.has(action.type)) {
    return { ...history, present: next };
  }

  let past = [
    ...history.past,
    { doc: cloneEditorDocument(history.present), inkUndo: {} },
  ];
  if (past.length > HISTORY_DEPTH) {
    past = past.slice(past.length - HISTORY_DEPTH);
  }
  return {
    present: next,
    past,
    future: [],
  };
}
