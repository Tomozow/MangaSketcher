import { describe, expect, test } from 'vitest';
import { createDocument, sequentialIds } from '../../../domain/document';
import { layoutWorkspace } from '../../../domain/layout';
import { isStockPageItem, isStockTextItem } from '../../../domain/stockItems';
import { buildStripFrames } from '../../../domain/stripGeometry';
import { reduceTestDocument, type DocumentAction } from '../../../domain/reducer';
import {
  dropStockPageToTrash,
  dropWorkspacePageToTrash,
  moveTextToStock,
  moveWorkspacePageToStock,
  nextFreeStockPagePosition,
  returnStockPageToWorkspace,
  returnStockTextToWorkspace,
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

function apply(doc: ReturnType<typeof blankDoc>, actions: { type: string }[]) {
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

  test('ストックへドロップした順に並び、新しいアイテムは配列末尾（左）へ付く', () => {
    let doc = blankDoc(2);
    const [a, b] = doc.workspaceOrder;
    const ids = sequentialIds('fg');
    doc = reduceTestDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'pasteboard' },
        box: { x: 1, y: 1, width: 8, height: 20 },
        content: '台',
      },
      ids,
    );
    const textId = doc.pasteboardTexts[0]!.id;
    doc = apply(doc, moveTextToStock(textId, 2, 3, doc.rasterWidth, doc.rasterHeight));
    doc = apply(doc, moveWorkspacePageToStock(a, 0, 10, 12, doc.rasterWidth, doc.rasterHeight));
    doc = apply(doc, moveWorkspacePageToStock(b, 0, 20, 12, doc.rasterWidth, doc.rasterHeight));
    expect(isStockTextItem(doc.stock[0]!)).toBe(true);
    expect(doc.stock[0]).toMatchObject({ textId });
    expect(doc.stock.slice(1).every(isStockPageItem)).toBe(true);
    expect(doc.stock[1]).toMatchObject({ pageId: a });
    expect(doc.stock[2]).toMatchObject({ pageId: b });
  });

  test('next free stock page position tiles after existing pages', () => {
    expect(nextFreeStockPagePosition([])).toEqual({ x: 8, y: 8 });
    expect(nextFreeStockPagePosition([{ pageId: 'a', x: 8, y: 8 }])).toEqual({ x: 88, y: 8 });
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

  test('ストックテキストはページ上ならページへ、それ以外はペーストボードへ戻す', () => {
    let doc = blankDoc(1);
    const pageId = doc.workspaceOrder[0]!;
    const ids = sequentialIds('tx');
    doc = reduceTestDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'pasteboard' },
        box: { x: 400, y: 400, width: 8, height: 20 },
        content: '台紙',
      },
      ids,
    );
    const textId = doc.pasteboardTexts[0]!.id;
    doc = apply(doc, moveTextToStock(textId, 2, 3, doc.rasterWidth, doc.rasterHeight));
    const { frames } = buildStripFrames(doc.workspaceOrder);
    const pageFrame = frames.find((item) => item.slot.kind === 'page')!;

    doc = apply(
      doc,
      returnStockTextToWorkspace({
        textId,
        pointerWorldX: pageFrame.x + pageFrame.width / 2,
        pointerWorldY: pageFrame.y + pageFrame.height / 2,
        box: { x: 400, y: 400, width: 8, height: 20 },
        fontSize: 12,
        frames,
        rasterWidth: doc.rasterWidth,
        rasterHeight: doc.rasterHeight,
      }),
    );
    expect(doc.stock).toHaveLength(0);
    expect(doc.pasteboardTexts).toHaveLength(0);
    expect(doc.pages[pageId]!.texts.some((t) => t.id === textId)).toBe(true);

    doc = reduceTestDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'pasteboard' },
        box: { x: 10, y: 10, width: 8, height: 20 },
        content: '外',
      },
      ids,
    );
    const pasteId = doc.pasteboardTexts[0]!.id;
    doc = apply(doc, moveTextToStock(pasteId, 1, 1, doc.rasterWidth, doc.rasterHeight));
    doc = apply(
      doc,
      returnStockTextToWorkspace({
        textId: pasteId,
        pointerWorldX: pageFrame.x + pageFrame.width + 80,
        pointerWorldY: pageFrame.y + 10,
        box: { x: 10, y: 10, width: 8, height: 20 },
        fontSize: 12,
        frames,
        rasterWidth: doc.rasterWidth,
        rasterHeight: doc.rasterHeight,
      }),
    );
    expect(doc.pasteboardTexts.some((t) => t.id === pasteId)).toBe(true);
    expect(doc.pages[pageId]!.texts.some((t) => t.id === pasteId)).toBe(false);
  });

  test('ゴミ箱テキストをページへ出すとゴミ箱から消える', () => {
    let doc = blankDoc(1);
    const pageId = doc.workspaceOrder[0]!;
    const ids = sequentialIds('tt');
    doc = reduceTestDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'pasteboard' },
        box: { x: 10, y: 10, width: 8, height: 20 },
        content: '本文',
      },
      ids,
    );
    const textId = doc.pasteboardTexts[0]!.id;
    doc = reduceTestDocument(doc, { type: 'deleteStockText', textId }, ids);
    expect(doc.trashTexts).toEqual([textId]);
    const { frames } = buildStripFrames(doc.workspaceOrder);
    const pageFrame = frames.find((item) => item.slot.kind === 'page')!;

    doc = apply(
      doc,
      returnStockTextToWorkspace({
        textId,
        pointerWorldX: pageFrame.x + pageFrame.width / 2,
        pointerWorldY: pageFrame.y + pageFrame.height / 2,
        box: { x: 10, y: 10, width: 8, height: 20 },
        fontSize: 12,
        frames,
        rasterWidth: doc.rasterWidth,
        rasterHeight: doc.rasterHeight,
        fromTrash: true,
      }),
    );
    expect(doc.trashTexts).toEqual([]);
    expect(doc.pasteboardTexts.some((t) => t.id === textId)).toBe(false);
    expect(doc.pages[pageId]!.texts.some((t) => t.id === textId)).toBe(true);
  });
});