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

  test('editText resizes the box to the content', () => {
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
        box: { x: 100, y: 40, width: 80, height: 400 },
        content: '',
      },
      ids,
    );
    const textId = doc.selectedTextId!;
    doc = reduceEditorDocument(doc, { type: 'editText', textId, content: 'あ' }, ids);
    const one = doc.pages[pageId]!.texts[0]!;
    expect(one.content).toBe('あ');
    expect(one.box.width).toBeLessThan(80);
    expect(one.box.x + one.box.width).toBeCloseTo(180);
    doc = reduceEditorDocument(doc, { type: 'editText', textId, content: 'あ'.repeat(11) }, ids);
    const many = doc.pages[pageId]!.texts[0]!;
    expect(many.box.width).toBeGreaterThan(one.box.width);
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

  test('emptyTrash はゴミ箱のページを完全に削除する', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 2,
      ids: sequentialIds('page'),
    });
    const [a, b] = doc.workspaceOrder;
    doc = reduceEditorDocument(doc, { type: 'deleteWorkspacePage', pageId: b }, ids);
    expect(doc.pages[b]).toBeDefined();
    doc = reduceEditorDocument(doc, { type: 'emptyTrash' }, ids);
    expect(doc.trash).toEqual([]);
    expect(doc.pages[b]).toBeUndefined();
    expect(doc.workspaceOrder).toEqual([a]);
  });
});

describe('select texts and bulk font size', () => {
  test('selectTexts keeps multiple ids and setTextsFontSize scales all boxes', () => {
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
        box: { x: 10, y: 20, width: 10, height: 20 },
        content: 'あ',
      },
      ids,
    );
    const a = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId },
        box: { x: 40, y: 20, width: 10, height: 20 },
        content: 'い',
      },
      ids,
    );
    const b = doc.selectedTextId!;
    doc = reduceEditorDocument(doc, { type: 'selectTexts', textIds: [a, b] }, ids);
    expect(doc.selectedTextIds).toEqual([a, b]);
    expect(doc.selectedTextId).toBe(b);

    const beforeA = doc.pages[pageId]!.texts.find((t) => t.id === a)!;
    const startSize = beforeA.fontSize;
    doc = reduceEditorDocument(doc, { type: 'setTextsFontSize', textIds: [a, b], fontSize: startSize * 2 }, ids);
    const afterA = doc.pages[pageId]!.texts.find((t) => t.id === a)!;
    const afterB = doc.pages[pageId]!.texts.find((t) => t.id === b)!;
    expect(afterA.fontSize).toBe(startSize * 2);
    expect(afterB.fontSize).toBe(startSize * 2);
    expect(afterA.box.width).toBe(20);
    expect(afterB.box.height).toBe(40);
  });

  test('deleteSelection removes every selected text and clip', () => {
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
        box: { x: 10, y: 20, width: 10, height: 20 },
        content: 'あ',
      },
      ids,
    );
    const textA = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId },
        box: { x: 40, y: 20, width: 10, height: 20 },
        content: 'い',
      },
      ids,
    );
    const textB = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      { type: 'commitMarqueeCut', pageId, clipId: 'c1', rasterId: 'p1:clip:c1', workspaceX: 0, workspaceY: 0 },
      ids,
    );
    doc = reduceEditorDocument(doc, { type: 'deleteSelection', textIds: [textA, textB], clipIds: ['c1'] }, ids);
    expect(doc.pages[pageId]!.texts).toHaveLength(0);
    expect(doc.pasteboardClips).toHaveLength(0);
    expect(doc.selectedTextIds).toEqual([]);
    expect(doc.selectedClipIds).toEqual([]);
  });

  test('selectClips from a marquee does not clear text selection', () => {
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
        box: { x: 10, y: 20, width: 10, height: 20 },
      },
      ids,
    );
    const textId = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'commitMarqueeCut',
        pageId,
        clipId: 'c1',
        rasterId: 'p1:clip:c1',
        workspaceX: 0,
        workspaceY: 0,
      },
      ids,
    );
    doc = reduceEditorDocument(doc, { type: 'selectTexts', textIds: [textId] }, ids);
    doc = reduceEditorDocument(doc, { type: 'selectClips', clipIds: ['c1'] }, ids);
    expect(doc.selectedTextIds).toEqual([textId]);
    expect(doc.selectedClipIds).toEqual(['c1']);
  });

  test('moveSelection offsets clips and texts in one action', () => {
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
        box: { x: 10, y: 20, width: 10, height: 20 },
      },
      ids,
    );
    const textId = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'commitMarqueeCut',
        pageId,
        clipId: 'c1',
        rasterId: 'p1:clip:c1',
        workspaceX: 5,
        workspaceY: 7,
      },
      ids,
    );
    doc = reduceEditorDocument(
      doc,
      {
        type: 'moveSelection',
        clips: [{ clipId: 'c1', x: 25, y: 27 }],
        texts: [{ textId, x: 40, y: 50 }],
      },
      ids,
    );
    expect(doc.pasteboardClips[0]).toMatchObject({ id: 'c1', x: 25, y: 27 });
    expect(doc.pages[pageId]!.texts[0]).toMatchObject({ id: textId, box: { x: 40, y: 50, width: 10, height: 20 } });
  });

  test('moveSelection reattaches each text to pasteboard or another page in one action', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'test',
      pageCount: 2,
      ids: sequentialIds('page'),
    });
    const pageA = doc.workspaceOrder[0]!;
    const pageB = doc.workspaceOrder[1]!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId: pageA },
        box: { x: 10, y: 20, width: 10, height: 20 },
        content: 'A',
      },
      ids,
    );
    const toPasteboard = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId: pageA },
        box: { x: 40, y: 20, width: 12, height: 24 },
        content: 'B',
      },
      ids,
    );
    const toOtherPage = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'pasteboard' },
        box: { x: 8, y: 9, width: 18, height: 36 },
        content: 'C',
      },
      ids,
    );
    const toPage = doc.selectedTextId!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'commitMarqueeCut',
        pageId: pageA,
        clipId: 'c1',
        rasterId: 'p1:clip:c1',
        workspaceX: 5,
        workspaceY: 7,
      },
      ids,
    );

    let history = createEditorHistory(doc);
    history = reduceEditorHistory(
      history,
      {
        type: 'moveSelection',
        clips: [{ clipId: 'c1', x: 30, y: 40 }],
        texts: [
          {
            textId: toPasteboard,
            x: 80,
            y: 90,
            width: 18,
            height: 36,
            fontSize: 14,
            attachment: { kind: 'pasteboard' },
          },
          {
            textId: toOtherPage,
            x: 6,
            y: 8,
            attachment: { kind: 'page', pageId: pageB },
          },
          {
            textId: toPage,
            x: 15,
            y: 16,
            width: 100,
            height: 200,
            fontSize: 80,
            attachment: { kind: 'page', pageId: pageA },
          },
        ],
      },
      ids,
    );
    doc = history.present;
    expect(doc.pasteboardClips[0]).toMatchObject({ id: 'c1', x: 30, y: 40 });
    expect(doc.pages[pageA]!.texts.map((t) => t.id)).toEqual([toPage]);
    expect(doc.pages[pageA]!.texts[0]).toMatchObject({
      id: toPage,
      fontSize: 80,
      box: { x: 15, y: 16, width: 100, height: 200 },
    });
    expect(doc.pages[pageB]!.texts).toMatchObject([{ id: toOtherPage, box: { x: 6, y: 8, width: 12, height: 24 } }]);
    expect(doc.pasteboardTexts).toMatchObject([
      { id: toPasteboard, fontSize: 14, box: { x: 80, y: 90, width: 18, height: 36 } },
    ]);

    history = reduceEditorHistory(history, { type: 'undo' }, ids);
    expect(history.present.pages[pageA]!.texts.map((t) => t.id).sort()).toEqual([toOtherPage, toPasteboard].sort());
    expect(history.present.pages[pageB]!.texts).toEqual([]);
    expect(history.present.pasteboardTexts.map((t) => t.id)).toEqual([toPage]);
    expect(history.present.pasteboardClips[0]).toMatchObject({ id: 'c1', x: 5, y: 7 });
  });
});
