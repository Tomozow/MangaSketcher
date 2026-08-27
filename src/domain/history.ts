import { cloneDocument } from './document';
import { reduceDocument, type DocumentAction } from './reducer';
import type { HistoryState } from './types';
import type { IdFactory } from './document';

const VIEW_ONLY = new Set([
  'selectPage',
  'setTool',
  'setToolProperties',
  'setWorkspaceView',
  'setStockView',
  'setPdfView',
  'selectClip',
  'selectText',
  'setUiLayout',
]);

export function createHistory(present: HistoryState['present']): HistoryState {
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
  const next = reduceDocument(history.present, action, ids);
  if (VIEW_ONLY.has(action.type)) {
    return { ...history, present: next };
  }
  return {
    present: next,
    past: [...history.past, cloneDocument(history.present)],
    future: [],
  };
}
