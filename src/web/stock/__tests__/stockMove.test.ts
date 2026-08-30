import { describe, expect, test } from 'vitest';
import { createDocument, sequentialIds } from '../../../domain/document';
import { layoutWorkspace } from '../../../domain/layout';
import { reduceTestDocument, type DocumentAction } from '../../../domain/reducer';
import {
  dropStockPageToTrash,
  dropWorkspacePageToTrash,
  moveWorkspacePageToStock,
  returnStockPageToWorkspace,
} from '../stockActions';

function blankDoc(pageCount: number) {
  return createDocument({
    projectId: 'p1',
    name: 'test',
    pageCount,
    rasterWidth: 16,
    rasterHeight: 20,
    ids: sequentialIds('page'),
  });
}

function apply(
  doc: ReturnType<typeof blankDoc>,
  actions: ReturnType<typeof moveWorkspacePageToStock> | ReturnType<typeof dropWorkspacePageToTrash>,
) {
  let next = doc;
  const ids = sequentialIds('a');
  for (const action of actions) {
    next = reduceTestDocument(next, action as DocumentAction, ids);
  }
  return next;
}

describe('stock MOVE adapters', () => {
  test('workspace to stock closes gap and allows empty workspace', () => {
    let doc = blankDoc(2);
    const [a, b] = doc.workspaceOrder;
    doc = apply(doc, moveWorkspacePageToStock(a, 0, 10, 12, doc.rasterWidth, doc.rasterHeight));
    expect(doc.workspaceOrder).toEqual([b]);
    doc = apply(doc, moveWorkspacePageToStock(b, 0, 0, 0, doc.rasterWidth, doc.rasterHeight));
    expect(doc.workspaceOrder).toHaveLength(0);
    expect(doc.stock).toHaveLength(2);
    expect(layoutWorkspace(doc.workspaceOrder).pageNumbers).toEqual([]);
  });

  test('stock to workspace inserts at reading index', () => {
    let doc = blankDoc(3);
    const page2 = doc.workspaceOrder[1];
    doc = apply(doc, moveWorkspacePageToStock(page2, 1, 4, 6, doc.rasterWidth, doc.rasterHeight));
    doc = apply(doc, returnStockPageToWorkspace(page2, 0, doc.rasterWidth, doc.rasterHeight));
    expect(doc.workspaceOrder[0]).toBe(page2);
    expect(doc.stock).toHaveLength(0);
    expect(layoutWorkspace(doc.workspaceOrder).pageNumbers).toEqual([1, 2, 3]);
  });

  test('workspace or stock drop onto trash moves the page', () => {
    let doc = blankDoc(2);
    const [a, b] = doc.workspaceOrder;
    doc = apply(doc, dropWorkspacePageToTrash(b));
    expect(doc.workspaceOrder).toEqual([a]);
    expect(doc.trash).toEqual([b]);
    doc = apply(doc, moveWorkspacePageToStock(a, 0, 0, 0, doc.rasterWidth, doc.rasterHeight));
    doc = apply(doc, dropStockPageToTrash(a));
    expect(doc.stock).toHaveLength(0);
    expect(doc.trash).toEqual([b, a]);
  });

  test('pasteboard world coordinates stay fixed across stock moves', () => {
    let doc = blankDoc(3);
    const page2 = doc.workspaceOrder[1];
    const ids = sequentialIds('pb');
    doc = reduceTestDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'pasteboard' },
        box: { x: 100, y: 20, width: 8, height: 20 },
        content: '台紙',
      },
      ids,
    );
    doc = reduceTestDocument(
      doc,
      {
        type: 'marqueeCut',
        pageId: doc.workspaceOrder[0],
        rect: { x: 0, y: 0, width: 2, height: 2 },
        workspaceX: 50,
        workspaceY: 10,
      },
      ids,
    );
    const textBefore = { ...doc.pasteboardTexts[0].box };
    const clipBefore = {
      x: doc.pasteboardClips[0].x,
      y: doc.pasteboardClips[0].y,
      scale: doc.pasteboardClips[0].scale,
      rotation: doc.pasteboardClips[0].rotation,
    };

    doc = apply(doc, moveWorkspacePageToStock(page2, 1, 8, 8, doc.rasterWidth, doc.rasterHeight));
    expect(doc.pasteboardTexts[0].box).toEqual(textBefore);
    expect(doc.pasteboardClips[0]).toMatchObject(clipBefore);

    doc = apply(doc, returnStockPageToWorkspace(page2, 2, doc.rasterWidth, doc.rasterHeight));
    expect(doc.pasteboardTexts[0].box).toEqual(textBefore);
    expect(doc.pasteboardClips[0]).toMatchObject(clipBefore);
  });
});