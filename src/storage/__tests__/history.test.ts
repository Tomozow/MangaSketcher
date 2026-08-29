import {
  createEditorHistory,
  pushEditorHistory,
  redoEditorHistory,
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

  test('round-trips document and ink through repeated undo and redo', () => {
    let history = createEditorHistory(createEditorDocument({ name: 'h', pageCount: 1 }));
    const rasterId = Object.values(history.present.pages)[0]!.rasterId;
    const inkStore = new Map<string, ArrayBuffer>([
      [rasterId, Uint8Array.from([3]).buffer],
    ]);
    history = pushEditorHistory(
      history,
      { ...history.present, inkGeneration: 1 },
      new Map([[rasterId, Uint8Array.from([1]).buffer]]),
      false,
    );

    const undone = undoEditorHistory(history, inkSink(inkStore));
    expect(undone?.present.inkGeneration).toBe(0);
    expect(new Uint8Array(inkStore.get(rasterId)!)[0]).toBe(1);

    const redone = redoEditorHistory(undone!, inkSink(inkStore));
    expect(redone?.present.inkGeneration).toBe(1);
    expect(new Uint8Array(inkStore.get(rasterId)!)[0]).toBe(3);

    const undoneAgain = undoEditorHistory(redone!, inkSink(inkStore));
    expect(undoneAgain?.present.inkGeneration).toBe(0);
    expect(new Uint8Array(inkStore.get(rasterId)!)[0]).toBe(1);
  });

  test('preserves redo after a view-only action following undo', () => {
    let history = createEditorHistory(createEditorDocument({ name: 'h', pageCount: 1 }));
    history = pushEditorHistory(
      history,
      { ...history.present, inkGeneration: 1 },
      new Map(),
      false,
    );
    history = undoEditorHistory(history, inkSink(new Map()))!;

    history = pushEditorHistory(
      history,
      { ...history.present, workspacePanX: 25 },
      new Map(),
      true,
    );

    expect(history.future).toHaveLength(1);
    expect(redoEditorHistory(history, inkSink(new Map()))?.present.inkGeneration).toBe(1);
  });

  test('clears redo after a new document edit following undo', () => {
    let history = createEditorHistory(createEditorDocument({ name: 'h', pageCount: 1 }));
    history = pushEditorHistory(
      history,
      { ...history.present, inkGeneration: 1 },
      new Map(),
      false,
    );
    history = undoEditorHistory(history, inkSink(new Map()))!;

    history = pushEditorHistory(
      history,
      { ...history.present, name: 'replacement edit' },
      new Map(),
      false,
    );

    expect(history.future).toHaveLength(0);
    expect(redoEditorHistory(history, inkSink(new Map()))).toBeNull();
  });

  test('copies ink undo independently from the caller buffer', () => {
    let history = createEditorHistory(createEditorDocument({ name: 'h', pageCount: 1 }));
    const rasterId = Object.values(history.present.pages)[0]!.rasterId;
    const source = Uint8Array.from([7]);
    const pendingInkUndo = new Map<string, ArrayBuffer>([[rasterId, source.buffer]]);

    history = pushEditorHistory(
      history,
      { ...history.present, inkGeneration: 1 },
      pendingInkUndo,
      false,
    );
    source[0] = 9;
    pendingInkUndo.clear();

    const stored = history.past.at(-1)?.inkUndo.get(rasterId);
    expect(stored).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(stored as ArrayBuffer)[0]).toBe(7);
  });
});
