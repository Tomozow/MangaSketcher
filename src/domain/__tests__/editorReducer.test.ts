import { describe, expect, test } from 'vitest';

import { createEditorDocument, sequentialIds } from '../document';
import { reduceEditorDocument } from '../editorReducer';
import { createEditorHistory, reduceEditorHistory } from '../history';

describe('reduceEditorDocument VIEW_ONLY', () => {
  test('パンで pages オブジェクト参照を共有し inkGeneration を変えない', () => {
    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 2,
      ids: sequentialIds('page'),
    });
    const pageRef = doc.pages[doc.workspaceOrder[0]];
    const beforeGen = doc.inkGeneration;
    const next = reduceEditorDocument(doc, {
      type: 'setWorkspaceView',
      zoom: 2,
      panX: 40,
      panY: 20,
    }, sequentialIds('id'));
    expect(next.workspaceZoom).toBe(2);
    expect(next.workspacePanX).toBe(40);
    expect(next.pages[doc.workspaceOrder[0]]).toBe(pageRef);
    expect(next.inkGeneration).toBe(beforeGen);
  });

  test('VIEW_ONLY は履歴に積まない', () => {
    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const ids = sequentialIds('a');
    let history = createEditorHistory(doc);
    history = reduceEditorHistory(history, { type: 'setWorkspaceView', zoom: 1.5, panX: 0, panY: 0 }, ids);
    expect(history.past).toHaveLength(0);
    history = reduceEditorHistory(history, { type: 'appendPage' }, ids);
    expect(history.past).toHaveLength(1);
  });
});
