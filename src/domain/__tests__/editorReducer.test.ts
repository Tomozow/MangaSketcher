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

describe('deleteText', () => {
  test('ページ所属テキストを削除し選択を解除する', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const pageId = doc.workspaceOrder[0]!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId },
        box: { x: 1, y: 2, width: 8, height: 20 },
        content: '残す',
      },
      ids,
    );
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId },
        box: { x: 4, y: 2, width: 8, height: 20 },
        content: '',
      },
      ids,
    );
    const emptyId = doc.selectedTextId!;
    doc = reduceEditorDocument(doc, { type: 'deleteText', textId: emptyId }, ids);
    expect(doc.pages[pageId]!.texts).toHaveLength(1);
    expect(doc.pages[pageId]!.texts[0]!.content).toBe('残す');
    expect(doc.selectedTextId).toBeNull();
  });

  test('duplicateText copies the box and selects the clone', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const pageId = doc.workspaceOrder[0]!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId },
        box: { x: 10, y: 20, width: 8, height: 20 },
        content: '本文',
      },
      ids,
    );
    const sourceId = doc.selectedTextId!;
    doc = reduceEditorDocument(doc, { type: 'duplicateText', textId: sourceId }, ids);
    expect(doc.pages[pageId]!.texts).toHaveLength(2);
    expect(doc.pages[pageId]!.texts[1]).toMatchObject({
      content: '本文',
      box: { x: 42, y: 52, width: 8, height: 20 },
    });
    expect(doc.selectedTextId).not.toBe(sourceId);
  });
});

describe('text attachment placement', () => {
  test('page/pasteboard conversion can preserve the rendered font scale', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const pageId = doc.workspaceOrder[0]!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'pasteboard' },
        box: { x: 20, y: 30, width: 18, height: 36 },
        content: '本文',
      },
      ids,
    );
    const textId = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'attachTextToPage',
        textId,
        pageId,
        pageBox: { x: 100, y: 200, width: 100, height: 200 },
        fontSize: 80,
      },
      ids,
    );
    expect(doc.pages[pageId]!.texts[0]).toMatchObject({
      id: textId,
      fontSize: 80,
      box: { x: 100, y: 200, width: 100, height: 200 },
    });
    doc = reduceEditorDocument(
      doc,
      {
        type: 'detachTextToPasteboard',
        textId,
        workspaceBox: { x: 50, y: 60, width: 18, height: 36 },
        fontSize: 14,
      },
      ids,
    );
    expect(doc.pasteboardTexts[0]).toMatchObject({
      id: textId,
      fontSize: 14,
      box: { x: 50, y: 60, width: 18, height: 36 },
    });
  });
});

describe('trash', () => {
  test('ワークスペース削除はページをゴミ箱へ移し、復元できる', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 2,
      ids: sequentialIds('page'),
    });
    const [a, b] = doc.workspaceOrder;
    doc = reduceEditorDocument(doc, { type: 'deleteWorkspacePage', pageId: b }, ids);
    expect(doc.workspaceOrder).toEqual([a]);
    expect(doc.trash).toEqual([b]);
    expect(doc.pages[b]).toBeDefined();
    doc = reduceEditorDocument(doc, { type: 'returnTrashToWorkspace', pageId: b, readingIndex: 0 }, ids);
    expect(doc.workspaceOrder).toEqual([b, a]);
    expect(doc.trash).toEqual([]);
  });

  test('ストックペイン切替は VIEW_ONLY', () => {
    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const ids = sequentialIds('a');
    let history = createEditorHistory(doc);
    history = reduceEditorHistory(history, { type: 'setUiLayout', stockPane: 'trash' }, ids);
    expect(history.past).toHaveLength(0);
    expect(history.present.stockPane).toBe('trash');
  });
});
