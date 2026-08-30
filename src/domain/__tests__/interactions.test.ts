import { describe, expect, test } from 'vitest';

import { dropActions, pageIdFromDrag } from '../drop';
import { layoutWorkspace, describeSpreads } from '../layout';
import { DEFAULT_PDF_MEDIA, normalizeRect, selectPdfBodyRange, viewRectToPdf } from '../pdfLayout';
import { joinVerticalBody, rangeSelectBody } from '../pdfText';
import { densifyStroke, streamlineStroke } from '../stroke';
import { canGrabPage, stepWorkspaceGesture } from '../workspaceGestures';
import { buildStripFrames, insertIndexForSlot } from '../stripGeometry';
import { hitTextBox, uniformResizeFromSE } from '../text';
import { inkPixelCount } from '../raster';
import { createDocument, sequentialIds } from '../document';
import { reduceTestDocument } from '../reducer';
import type { PdfTextItem } from '../types';

const source: PdfTextItem[] = [
  { str: '本', x: 200, y: 24, width: 12, height: 12, fontSize: 12 },
  { str: '文', x: 200, y: 10, width: 12, height: 12, fontSize: 12 },
  { str: 'ほん', x: 212, y: 8, width: 6, height: 6, fontSize: 6, role: 'Ruby' },
  { str: 'です', x: 180, y: 24, width: 12, height: 12, fontSize: 12 },
];

function docN(n: number) {
  return createDocument({
    projectId: 'p',
    name: 't',
    pageCount: n,
    rasterWidth: 16,
    rasterHeight: 20,
    ids: sequentialIds('g'),
  });
}

describe('PDF 範囲選択してドロップ', () => {
  test('範囲に入った本文だけを1オブジェクトにし、ルビは捨て、ソースは残る', () => {
    const ranged = rangeSelectBody(source, { x: 198, y: 5, width: 22, height: 30 });
    expect(ranged.map((i) => i.str).join('')).toBe('本文');
    expect(joinVerticalBody(ranged)).toBe('本文');

    const ids = sequentialIds('x');
    let doc = docN(1);
    doc = reduceTestDocument(
      doc,
      { type: 'loadPdf', opfsPath: 'pdfs/p/s.pdf', pageCount: 1, sourceTextByPage: { 1: source.map((i) => ({ ...i })) } },
      ids,
    );
    const before = JSON.stringify(doc.pdf?.sourceTextByPage[1]);
    const actions = dropActions(
      { type: 'pdfText', pdfPage: 1, range: { x: 198, y: 5, width: 22, height: 30 }, preview: '本文' },
      { zone: 'page', pageId: doc.workspaceOrder[0], localX: 3, localY: 4 },
      doc.rasterWidth,
      doc.rasterHeight,
    );
    for (const action of actions) {
      doc = reduceTestDocument(doc, action, ids);
    }
    expect(doc.pages[doc.workspaceOrder[0]].texts[0].content).toBe('本文');
    expect(JSON.stringify(doc.pdf?.sourceTextByPage[1])).toBe(before);

    const textId = doc.pages[doc.workspaceOrder[0]].texts[0].id;
    doc = reduceTestDocument(doc, { type: 'editText', textId, content: '本文を直した' }, ids);
    expect(doc.pages[doc.workspaceOrder[0]].texts[0].content).toBe('本文を直した');
    expect(JSON.stringify(doc.pdf?.sourceTextByPage[1])).toBe(before);
  });

  test('ビューのドラッグ矩形を PDF 座標へ写して範囲選択できる', () => {
    const view = normalizeRect(10, 10, 80, 90);
    const pdfRect = viewRectToPdf(view, 200, 200, DEFAULT_PDF_MEDIA);
    expect(pdfRect.width).toBeGreaterThan(0);
    expect(pdfRect.height).toBeGreaterThan(0);
    const picked = selectPdfBodyRange(source, { x: 0, y: 0, width: 200, height: 200 }, 200, 200, {
      width: 400,
      height: 80,
    });
    expect(picked.every((i) => i.role !== 'Ruby')).toBe(true);
  });
});

describe('ストックの自由配置と列への復帰', () => {
  test('ワークスペースからストックへドロップすると隙間が閉じ、列位置へ戻せる', () => {
    const ids = sequentialIds('s');
    let doc = docN(3);
    const page2 = doc.workspaceOrder[1];
    for (const action of dropActions(
      { type: 'workspacePage', pageId: page2, fromIndex: 1 },
      { zone: 'stock', x: 40, y: 18 },
      doc.rasterWidth,
      doc.rasterHeight,
    )) {
      doc = reduceTestDocument(doc, action, ids);
    }
    expect(doc.workspaceOrder).toHaveLength(2);
    expect(doc.stock[0]).toEqual({ pageId: page2, x: 40, y: 18 });
    expect(pageIdFromDrag({ type: 'workspacePage', pageId: page2, fromIndex: 1 })).toBe(page2);
    expect(pageIdFromDrag({ type: 'stockPage', pageId: page2 })).toBe(page2);
    expect(pageIdFromDrag({ type: 'pdfText', pdfPage: 1, range: { x: 0, y: 0, width: 1, height: 1 }, preview: 'a' })).toBeNull();
    doc = reduceTestDocument(doc, { type: 'placeStock', pageId: page2, x: 90, y: 40 }, ids);
    expect(doc.stock[0].x).toBe(90);
    for (const action of dropActions(
      { type: 'stockPage', pageId: page2 },
      { zone: 'workspaceInsert', readingIndex: 0 },
      doc.rasterWidth,
      doc.rasterHeight,
    )) {
      doc = reduceTestDocument(doc, action, ids);
    }
    expect(doc.workspaceOrder[0]).toBe(page2);
    expect(doc.stock).toHaveLength(0);
    expect(layoutWorkspace(doc.workspaceOrder).pageNumbers).toEqual([1, 2, 3]);
  });
});

describe('指の長押し並べ替え（Pencil では掴まない）', () => {
  test('finger longpress だけが grab、pencil は stroke', () => {
    expect(canGrabPage('finger', 'longpress')).toBe(true);
    expect(canGrabPage('pencil', 'longpress')).toBe(false);
    expect(canGrabPage('finger', 'move')).toBe(false);

    const pageHit = {
      kind: 'page' as const,
      pageId: 'p1',
      localX: 1,
      localY: 1,
      readingIndex: 0,
      insertIndex: 0,
    };
    const grab = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'finger',
        phase: 'longpress',
        tool: 'pen',
        x: 0,
        y: 0,
        pressure: 1,
        hit: pageHit,
        touchCount: 1,
        now: 1000,
        selectedClipId: null,
      },
    );
    expect(grab.effects).toEqual([{ type: 'grabPage', pageId: 'p1', fromIndex: 0 }]);

    const pencil = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'pencil',
        phase: 'move',
        tool: 'pen',
        x: 4,
        y: 5,
        pressure: 0.6,
        hit: pageHit,
        touchCount: 1,
        now: 1000,
        selectedClipId: null,
      },
    );
    expect(pencil.effects[0]).toMatchObject({ type: 'stampPage', pageId: 'p1', erase: false });
    expect(pencil.state.mode).toBe('stroke');

    const pencilLong = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'pencil',
        phase: 'longpress',
        tool: 'pen',
        x: 0,
        y: 0,
        pressure: 1,
        hit: pageHit,
        touchCount: 1,
        now: 1000,
        selectedClipId: null,
      },
    );
    expect(pencilLong.effects.some((e) => e.type === 'grabPage')).toBe(false);
  });

  test('ドロップ位置の insertIndex で見開きが再計算される', () => {
    const ids = sequentialIds('r');
    let doc = docN(4);
    const { frames } = buildStripFrames(doc.workspaceOrder);
    const pageFrame = frames.find((f) => f.slot.kind === 'page' && f.slot.number === 3);
    expect(pageFrame).toBeTruthy();
    expect(insertIndexForSlot(pageFrame!.slot, doc.workspaceOrder)).toBe(2);
    const first = doc.workspaceOrder[0];
    for (const action of dropActions(
      { type: 'workspacePage', pageId: first, fromIndex: 0 },
      { zone: 'workspaceInsert', readingIndex: 2 },
      doc.rasterWidth,
      doc.rasterHeight,
    )) {
      doc = reduceTestDocument(doc, action, ids);
    }
    expect(doc.workspaceOrder[2]).toBe(first);
    expect(layoutWorkspace(doc.workspaceOrder).pageNumbers).toEqual([1, 2, 3, 4]);
    expect(describeSpreads(layoutWorkspace(doc.workspaceOrder))).toEqual(['4', '3|2', '1|余白']);
  });
});

describe('ペンストロークとクリップ焼き込み', () => {
  test('折れ線がラスタ1層に焼かれ、消しゴムはテキストを残す', () => {
    const ids = sequentialIds('i');
    let doc = docN(1);
    const pageId = doc.workspaceOrder[0];
    doc = reduceTestDocument(
      doc,
      {
        type: 'strokeInk',
        target: { kind: 'page', pageId },
        points: [
          { x: 2, y: 4, pressure: 1 },
          { x: 10, y: 4, pressure: 0.5 },
        ],
        pointerKind: 'pencil',
        erase: false,
      },
      ids,
    );
    expect(inkPixelCount(doc.pages[pageId].raster)).toBeGreaterThan(8);
    doc = reduceTestDocument(
      doc,
      {
        type: 'createText',
        attachment: { kind: 'page', pageId },
        box: { x: 0, y: 0, width: 8, height: 12 },
        content: 'セリフ',
      },
      ids,
    );
    doc = reduceTestDocument(
      doc,
      {
        type: 'strokeInk',
        target: { kind: 'page', pageId },
        points: [
          { x: 2, y: 4, pressure: 1 },
          { x: 10, y: 4, pressure: 1 },
        ],
        pointerKind: 'pencil',
        erase: true,
      },
      ids,
    );
    expect(doc.pages[pageId].texts[0].content).toBe('セリフ');
  });

  test('perfect-freehand 風の補間で隙間なく焼ける', () => {
    const raw = [
      { x: 0, y: 0, pressure: 1 },
      { x: 8, y: 0, pressure: 0.5 },
    ];
    const smooth = streamlineStroke(raw);
    expect(smooth.length).toBeGreaterThan(1);
    expect(densifyStroke(smooth, 0.8).length).toBeGreaterThan(smooth.length);
  });
});

describe('テキストツールの移動・リサイズ・プロパティ', () => {
  test('ヒット判定は本体と SE ハンドルを分け、指では移動しない', () => {
    const box = { x: 10, y: 10, width: 20, height: 40 };
    expect(hitTextBox(box, 18, 25, 8)).toBe('body');
    expect(hitTextBox(box, 28, 48, 8)).toBe('se');
    expect(hitTextBox(box, 0, 0, 8)).toBeNull();

    const grown = uniformResizeFromSE(box, 10 + 40, 10 + 80);
    expect(grown.width / grown.height).toBeCloseTo(20 / 40);
    expect(grown.width).toBeCloseTo(40);

    const move = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'pencil',
        phase: 'move',
        tool: 'text',
        x: 12,
        y: 14,
        pressure: 1,
        hit: { kind: 'pageText', textId: 'tx', pageId: 'p1', localX: 12, localY: 14 },
        touchCount: 1,
        now: 1,
        selectedClipId: null,
      },
    );
    expect(move.effects).toEqual(
      expect.arrayContaining([
        { type: 'selectText', textId: 'tx' },
        { type: 'moveText', textId: 'tx', x: 12, y: 14 },
      ]),
    );

    const resize = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'pencil',
        phase: 'move',
        tool: 'text',
        x: 50,
        y: 90,
        pressure: 1,
        hit: { kind: 'resizeHandle', textId: 'tx', localX: 50, localY: 90 },
        touchCount: 1,
        now: 1,
        selectedClipId: null,
      },
    );
    expect(resize.state.mode).toBe('resizeText');
    expect(resize.effects).toEqual(
      expect.arrayContaining([{ type: 'resizeText', textId: 'tx', x: 50, y: 90 }]),
    );

    const finger = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'finger',
        phase: 'move',
        tool: 'text',
        x: 12,
        y: 14,
        pressure: 1,
        hit: { kind: 'pageText', textId: 'tx', pageId: 'p1', localX: 12, localY: 14 },
        touchCount: 1,
        now: 1,
        selectedClipId: null,
      },
    );
    expect(finger.effects.some((e) => e.type === 'moveText')).toBe(false);
  });

  test('指は選択して本文編集へ渡し、Pencil は枠を動かして回転はしない', () => {
    const down = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'finger',
        phase: 'down',
        tool: 'text',
        x: 12,
        y: 14,
        pressure: 1,
        hit: { kind: 'pageText', textId: 'tx', pageId: 'p1', localX: 12, localY: 14 },
        touchCount: 1,
        now: 1,
        selectedClipId: null,
      },
    );
    expect(down.effects).toEqual([{ type: 'selectText', textId: 'tx' }]);
    expect(down.effects.some((e) => e.type === 'moveText')).toBe(false);

    const dragFinger = stepWorkspaceGesture(down.state, {
      kind: 'finger',
      phase: 'move',
      tool: 'text',
      x: 40,
      y: 50,
      pressure: 1,
        hit: { kind: 'pageText', textId: 'tx', pageId: 'p1', localX: 40, localY: 50 },
      touchCount: 1,
      now: 2,
      selectedClipId: null,
    });
    expect(dragFinger.effects.some((e) => e.type === 'panBy')).toBe(false);
    expect(dragFinger.effects.some((e) => e.type === 'moveText')).toBe(false);

    const pbDown = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'finger',
        phase: 'down',
        tool: 'text',
        x: 8,
        y: 8,
        pressure: 1,
        hit: { kind: 'pasteboardText', textId: 'pb' },
        touchCount: 1,
        now: 1,
        selectedClipId: null,
      },
    );
    expect(pbDown.effects).toEqual([{ type: 'selectText', textId: 'pb' }]);
  });

  test('描画中はテキストヒットを無視し、リサイズ開始後はパンしない', () => {
    const pageText = {
      kind: 'pageText' as const,
      textId: 'tx',
      pageId: 'p1',
      localX: 4,
      localY: 5,
    };
    const ink = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'pencil',
        phase: 'move',
        tool: 'pen',
        x: 4,
        y: 5,
        pressure: 1,
        hit: pageText,
        touchCount: 1,
        now: 1,
        selectedClipId: null,
      },
    );
    expect(ink.effects[0]).toMatchObject({ type: 'stampPage', pageId: 'p1', erase: false });

    const resized = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'pencil',
        phase: 'down',
        tool: 'text',
        x: 50,
        y: 90,
        pressure: 1,
        hit: { kind: 'resizeHandle', textId: 'tx', localX: 50, localY: 90 },
        touchCount: 1,
        now: 1,
        selectedClipId: null,
      },
    );
    expect(resized.state.mode).toBe('resizeText');
    const stillResize = stepWorkspaceGesture(resized.state, {
      kind: 'pencil',
      phase: 'move',
      tool: 'text',
      x: 80,
      y: 120,
      pressure: 1,
      hit: { kind: 'empty' },
      touchCount: 1,
      now: 2,
      selectedClipId: null,
    });
    expect(stillResize.state.mode).toBe('resizeText');
    expect(stillResize.effects.some((e) => e.type === 'panBy')).toBe(false);
    expect(stillResize.effects).toEqual(
      expect.arrayContaining([{ type: 'resizeText', textId: 'tx', x: 80, y: 120 }]),
    );

    const pending = stepWorkspaceGesture(
      { mode: 'idle' },
      {
        kind: 'finger',
        phase: 'down',
        tool: 'pen',
        x: 0,
        y: 0,
        pressure: 1,
        hit: {
          kind: 'page',
          pageId: 'p1',
          localX: 1,
          localY: 1,
          readingIndex: 0,
          insertIndex: 0,
        },
        touchCount: 1,
        now: 1,
        selectedClipId: null,
      },
    );
    const panned = stepWorkspaceGesture(pending.state, {
      kind: 'finger',
      phase: 'move',
      tool: 'pen',
      x: 40,
      y: 0,
      pressure: 1,
      hit: pageText,
      touchCount: 1,
      now: 2,
      selectedClipId: null,
    });
    expect(panned.state.mode).toBe('pan');
    expect(panned.effects[0]).toMatchObject({ type: 'panBy', dx: 40, dy: 0 });
    const keepPan = stepWorkspaceGesture(panned.state, {
      kind: 'finger',
      phase: 'move',
      tool: 'pen',
      x: 50,
      y: 4,
      pressure: 1,
      hit: pageText,
      touchCount: 1,
      now: 3,
      selectedClipId: null,
    });
    expect(keepPan.state.mode).toBe('pan');
    expect(keepPan.effects.some((e) => e.type === 'moveText')).toBe(false);
  });
});
