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
});
