import {
  createEditorHistory,
  pushEditorHistory,
  undoEditorHistory,
} from '../history';
import { createEditorDocument } from '../editorDocument';
import { HISTORY_DEPTH } from '../types';

function inkSink(store: Map<string, ArrayBuffer>) {
  return {
    restoreRaster(rasterId: string, png: ArrayBuffer) {
      store.set(rasterId, png.slice(0));
    },
    captureRaster(rasterId: string) {
      return store.get(rasterId);
    },
    invalidateThumb() {},
  };
}

describe('EditorHistory', () => {
  test('keeps at most 50 past entries', () => {
    let history = createEditorHistory(createEditorDocument({ name: 'h', pageCount: 1 }));
    const ink = new Map<string, ArrayBuffer>([['r1', new ArrayBuffer(1)]]);
    for (let i = 0; i < HISTORY_DEPTH + 5; i += 1) {
      const next = { ...history.present, inkGeneration: i + 1 };
      history = pushEditorHistory(history, next, ink, false);
    }
    expect(history.past).toHaveLength(HISTORY_DEPTH);
    expect(history.past[0]!.doc.inkGeneration).toBe(5);
  });

  test('VIEW_ONLY actions do not push past', () => {
    let history = createEditorHistory(createEditorDocument({ name: 'h', pageCount: 1 }));
    const next = { ...history.present, workspacePanX: 10 };
    history = pushEditorHistory(history, next, new Map(), true);
    expect(history.past).toHaveLength(0);
    expect(history.present.workspacePanX).toBe(10);
  });

  test('undo restores document and ink snapshots', () => {
    let history = createEditorHistory(createEditorDocument({ name: 'h', pageCount: 1 }));
    const rasterId = Object.values(history.present.pages)[0]!.rasterId;
    const before = Uint8Array.from([1]).buffer;
    const after = Uint8Array.from([2]).buffer;
    const inkStore = new Map<string, ArrayBuffer>([[rasterId, after]]);
    history = pushEditorHistory(
      history,
      { ...history.present, inkGeneration: 1 },
      new Map([[rasterId, before]]),
      false,
    );
    const undone = undoEditorHistory(history, inkSink(inkStore));
    expect(undone?.present.inkGeneration).toBe(0);
    expect(new Uint8Array(inkStore.get(rasterId)!)[0]).toBe(1);
  });
});
