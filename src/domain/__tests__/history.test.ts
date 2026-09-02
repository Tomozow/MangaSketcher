import { describe, expect, test } from 'vitest';

import { createEditorDocument, sequentialIds } from '../document';
import { createEditorHistory, HISTORY_DEPTH, reduceEditorHistory } from '../history';

describe('reduceEditorHistory', () => {
  test('keeps at most 50 past entries', () => {
    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'depth',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const ids = sequentialIds('a');
    let history = createEditorHistory(doc);
    for (let i = 0; i < HISTORY_DEPTH + 5; i += 1) {
      history = reduceEditorHistory(history, { type: 'appendPage' }, ids);
    }
    expect(history.past).toHaveLength(HISTORY_DEPTH);
    expect(history.past[0]!.doc.workspaceOrder).toHaveLength(6);
  });

  test('VIEW_ONLY actions do not push past', () => {
    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'view',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const ids = sequentialIds('a');
    let history = createEditorHistory(doc);
    history = reduceEditorHistory(
      history,
      { type: 'setWorkspaceView', zoom: 1.25, panX: 8, panY: 4 },
      ids,
    );
    expect(history.past).toHaveLength(0);
    expect(history.present.workspaceZoom).toBe(1.25);
  });

  test('does not store text selection on past entries', () => {
    const ids = sequentialIds('a');
    let history = createEditorHistory(
      createEditorDocument({
        projectId: 'p1',
        name: 'sel',
        pageCount: 1,
        ids: sequentialIds('page'),
      }),
    );
    const pageId = history.present.workspaceOrder[0]!;
    history = reduceEditorHistory(
      history,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId },
        box: { x: 8, y: 8, width: 40, height: 80 },
        content: 'あ',
      },
      ids,
    );
    const textId = history.present.selectedTextId;
    expect(textId).toBeTruthy();
    expect(history.past[0]!.doc.selectedTextId).toBeNull();

    history = reduceEditorHistory(history, { type: 'rename', name: 'after' }, ids);
    expect(history.past.at(-1)!.doc.selectedTextId).toBeNull();

    history = reduceEditorHistory(history, { type: 'undo' }, ids);
    expect(history.present.selectedTextId).toBe(textId);
    expect(history.present.name).not.toBe('after');
  });
});
