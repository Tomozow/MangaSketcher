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

describe('clip chrome actions', () => {
  test('deleteClip removes the clip and clears selection', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    doc = reduceEditorDocument(
      doc,
      {
        type: 'commitMarqueeCut',
        pageId: doc.workspaceOrder[0]!,
        clipId: 'c1',
        rasterId: 'p1:clip:c1',
        workspaceX: 40,
        workspaceY: 50,
      },
      ids,
    );
    expect(doc.selectedClipId).toBe('c1');
    doc = reduceEditorDocument(doc, { type: 'deleteClip', clipIds: ['c1'] }, ids);
    expect(doc.pasteboardClips).toHaveLength(0);
    expect(doc.selectedClipId).toBeNull();
  });

  test('duplicateClip copies pose with offset and selects the clone', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    doc = reduceEditorDocument(
      doc,
      {
        type: 'commitMarqueeCut',
        pageId: doc.workspaceOrder[0]!,
        clipId: 'c1',
        rasterId: 'p1:clip:c1',
        workspaceX: 40,
        workspaceY: 50,
      },
      ids,
    );
    doc = reduceEditorDocument(
      doc,
      {
        type: 'duplicateClip',
        sourceClipId: 'c1',
        clipId: 'c2',
        rasterId: 'p1:clip:c2',
        x: 56,
        y: 66,
        scale: 1,
        rotation: 0,
      },
      ids,
    );
    expect(doc.pasteboardClips).toHaveLength(2);
    expect(doc.pasteboardClips[1]).toMatchObject({
      id: 'c2',
      rasterId: 'p1:clip:c2',
      x: 56,
      y: 66,
    });
    expect(doc.selectedClipId).toBe('c2');
  });

  test('selectClips keeps all touching ids and uses the last as primary', () => {
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
      { type: 'commitMarqueeCut', pageId, clipId: 'c1', rasterId: 'p1:clip:c1', workspaceX: 0, workspaceY: 0 },
      ids,
    );
    doc = reduceEditorDocument(
      doc,
      { type: 'commitMarqueeCut', pageId, clipId: 'c2', rasterId: 'p1:clip:c2', workspaceX: 20, workspaceY: 20 },
      ids,
    );
    doc = reduceEditorDocument(doc, { type: 'selectClips', clipIds: ['c1', 'c2'] }, ids);
    expect(doc.selectedClipIds).toEqual(['c1', 'c2']);
    expect(doc.selectedClipId).toBe('c2');
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

describe('loadPdf view restore', () => {
  test('同じ指紋ならページを残し、違う指紋なら 1 に戻す', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    doc = reduceEditorDocument(
      doc,
      {
        type: 'loadPdf',
        opfsPath: 'pdfs/p1.pdf',
        pageCount: 5,
        sourceTextByPage: {},
        sourceFingerprint: 'a.pdf:1:1',
      },
      ids,
    );
    doc = reduceEditorDocument(doc, { type: 'setPdfView', currentPage: 4, zoom: 1.5 }, ids);
    doc = reduceEditorDocument(
      doc,
      {
        type: 'loadPdf',
        opfsPath: 'pdfs/p1.pdf',
        pageCount: 5,
        sourceTextByPage: {},
        generation: 2,
        sourceFingerprint: 'a.pdf:1:1',
      },
      ids,
    );
    expect(doc.pdf?.currentPage).toBe(4);
    expect(doc.pdf?.zoom).toBe(1.5);
    doc = reduceEditorDocument(
      doc,
      {
        type: 'loadPdf',
        opfsPath: 'pdfs/p1.pdf',
        pageCount: 5,
        sourceTextByPage: {},
        generation: 3,
        sourceFingerprint: 'b.pdf:2:2',
      },
      ids,
    );
    expect(doc.pdf?.currentPage).toBe(1);
    expect(doc.pdf?.zoom).toBe(1);
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
