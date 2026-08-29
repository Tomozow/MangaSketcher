import { describe, expect, test } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { createDocument, sequentialIds } from '../document';
import { layoutWorkspace, describeLtr, describeSpreads } from '../layout';
import { reduceHistory, createHistory } from '../history';
import { reduceTestDocument, type DocumentAction } from '../reducer';
import { inkPixelCount } from '../raster';
import { resolvePointerIntent, brushRadius, workspacePointerPolicy, pdfPointerPolicy, stockPointerPolicy } from '../pointers';
import { pdfPageViewerKey } from '../pdfView';
import { mainPaneFlex, nextSplitFromDrag, SPLIT_MAX, SPLIT_MIN } from '../uiLayout';
import { findText, selectedTextForEditor, verticalGlyphs } from '../text';
import { stripRuby, joinVerticalBody, sanitizeExtractedBody } from '../pdfText';
import {
  createMemoryStore,
  saveProject,
  listProjects,
  loadProject,
  renameProject,
  deleteProject,
} from '../projects';
import type { DocumentState, PdfTextItem } from '../types';

function ids() {
  return sequentialIds('t');
}

function apply(doc: DocumentState, action: DocumentAction): DocumentState {
  return reduceTestDocument(doc, action, ids());
}

function blankDoc(pageCount: number, name = 'ネーム'): DocumentState {
  return createDocument({
    projectId: 'p1',
    name,
    pageCount,
    rasterWidth: 16,
    rasterHeight: 20,
    ids: sequentialIds('page'),
  });
}

describe('シナリオ: 新規プロジェクトの RTL レイアウト', () => {
  test('N ページで余白が右端、1 が単独、2-3 が見開き、+ が読み順の末尾', () => {
    const doc = blankDoc(5);
    const layout = layoutWorkspace(doc.workspaceOrder);
    expect(describeLtr(layout)).toEqual(['+', '5', '4', '3', '2', '1', '余白']);
    expect(describeSpreads(layout)).toEqual(['5|4', '3|2', '1|余白']);
    expect(layout.pageNumbers).toEqual([1, 2, 3, 4, 5]);
    expect(layout.ltrSlots[0]).toEqual({ kind: 'append' });
  });

  test('ページ数 1 でも余白と + がある', () => {
    const layout = layoutWorkspace(blankDoc(1).workspaceOrder);
    expect(describeLtr(layout)).toEqual(['+', '1', '余白']);
    expect(describeSpreads(layout)).toEqual(['1|余白']);
  });
});

describe('シナリオ: 挿入と追加でリナンバー・見開き再計算', () => {
  test('選択ページの後ろに挿入し、+ で末尾追加する', () => {
    let doc = blankDoc(3);
    doc = apply(doc, { type: 'selectPage', pageId: doc.workspaceOrder[0] });
    doc = apply(doc, { type: 'insertAfterSelected' });
    expect(doc.workspaceOrder).toHaveLength(4);
    expect(describeSpreads(layoutWorkspace(doc.workspaceOrder))).toEqual(['4', '3|2', '1|余白']);

    doc = apply(doc, { type: 'appendPage' });
    const layout = layoutWorkspace(doc.workspaceOrder);
    expect(layout.pageNumbers).toEqual([1, 2, 3, 4, 5]);
    expect(describeLtr(layout)).toEqual(['+', '5', '4', '3', '2', '1', '余白']);
    expect(describeSpreads(layout)).toEqual(['5|4', '3|2', '1|余白']);
  });
});

describe('シナリオ: 長押し並べ替えで見開き再計算', () => {
  test('読み順を入れ替えると見開きが組み直される', () => {
    let doc = blankDoc(4);
    const a = doc.workspaceOrder[0];
    const d = doc.workspaceOrder[3];
    doc = apply(doc, { type: 'reorderWorkspace', fromIndex: 0, toIndex: 3 });
    expect(doc.workspaceOrder[3]).toBe(a);
    expect(doc.workspaceOrder[2]).toBe(d);
    expect(describeSpreads(layoutWorkspace(doc.workspaceOrder))).toEqual(['4', '3|2', '1|余白']);
  });
});

describe('シナリオ: ストックへ移動・復帰・ペーストボードは残る', () => {
  test('ページをストックへ移すと隙間が閉じ、インクとテキストはページに残る', () => {
    let doc = blankDoc(3);
    const page2 = doc.workspaceOrder[1];
    const page1 = doc.workspaceOrder[0];
    doc = apply(doc, {
      type: 'stampInk',
      target: { kind: 'page', pageId: page2 },
      x: 4,
      y: 4,
      pressure: 1,
      pointerKind: 'pencil',
      erase: false,
    });
    doc = apply(doc, {
      type: 'createText',
      attachment: { kind: 'page', pageId: page2 },
      box: { x: 1, y: 1, width: 4, height: 10 },
      content: 'ネーム',
    });
    doc = apply(doc, {
      type: 'createText',
      attachment: { kind: 'pasteboard' },
      box: { x: 100, y: 20, width: 8, height: 20 },
      content: '台紙',
    });
    doc = apply(doc, {
      type: 'marqueeCut',
      pageId: page1,
      rect: { x: 0, y: 0, width: 2, height: 2 },
      workspaceX: 50,
      workspaceY: 10,
    });
    const pasteboardTextId = doc.pasteboardTexts[0].id;
    const clipId = doc.pasteboardClips[0].id;
    const inkBefore = inkPixelCount(doc.pages[page2].raster);

    doc = apply(doc, { type: 'movePageToStock', pageId: page2, x: 12, y: 8 });

    expect(doc.workspaceOrder).toHaveLength(2);
    expect(doc.workspaceOrder).not.toContain(page2);
    expect(describeLtr(layoutWorkspace(doc.workspaceOrder))).toEqual(['+', '2', '1', '余白']);
    expect(doc.stock).toEqual([{ pageId: page2, x: 12, y: 8 }]);
    expect(inkPixelCount(doc.pages[page2].raster)).toBe(inkBefore);
    expect(doc.pages[page2].texts[0].content).toBe('ネーム');
    expect(doc.pasteboardTexts[0].id).toBe(pasteboardTextId);
    expect(doc.pasteboardClips[0].id).toBe(clipId);
  });

  test('ストックから指定位置へ戻すと番号と見開きが再計算される', () => {
    let doc = blankDoc(3);
    const page1 = doc.workspaceOrder[0];
    doc = apply(doc, { type: 'movePageToStock', pageId: page1, x: 0, y: 0 });
    doc = apply(doc, { type: 'returnStockToWorkspace', pageId: page1, readingIndex: 1 });
    expect(doc.workspaceOrder[1]).toBe(page1);
    expect(layoutWorkspace(doc.workspaceOrder).pageNumbers).toEqual([1, 2, 3]);
    expect(describeSpreads(layoutWorkspace(doc.workspaceOrder))).toEqual(['3|2', '1|余白']);
    expect(doc.stock).toHaveLength(0);
  });

  test('ワークスペースを空にできる', () => {
    let doc = blankDoc(2);
    for (const id of [...doc.workspaceOrder]) {
      doc = apply(doc, { type: 'movePageToStock', pageId: id, x: 0, y: 0 });
    }
    expect(doc.workspaceOrder).toHaveLength(0);
    expect(describeLtr(layoutWorkspace(doc.workspaceOrder))).toEqual(['+', '余白']);
  });
});

describe('シナリオ: 削除', () => {
  test('ワークスペースとストックのページをゴミ箱へ移せる', () => {
    let doc = blankDoc(3);
    const [a, b, c] = doc.workspaceOrder;
    doc = apply(doc, { type: 'deleteWorkspacePage', pageId: b });
    expect(doc.workspaceOrder).toEqual([a, c]);
    expect(doc.pages[b]).toBeDefined();
    expect(doc.trash).toEqual([b]);
    doc = apply(doc, { type: 'movePageToStock', pageId: c, x: 1, y: 1 });
    doc = apply(doc, { type: 'deleteStockPage', pageId: c });
    expect(doc.stock).toHaveLength(0);
    expect(doc.pages[c]).toBeDefined();
    expect(doc.trash).toEqual([b, c]);
    expect(doc.workspaceOrder).toEqual([a]);
    doc = apply(doc, { type: 'returnTrashToWorkspace', pageId: b, readingIndex: 0 });
    expect(doc.workspaceOrder[0]).toBe(b);
    expect(doc.trash).toEqual([c]);
  });
});

describe('シナリオ: PDF 本文抽出とドロップ', () => {
  const source: PdfTextItem[] = [
    { str: '本', x: 200, y: 10, width: 12, height: 12, fontSize: 12 },
    { str: '文', x: 200, y: 24, width: 12, height: 12, fontSize: 12 },
    { str: 'ほん', x: 212, y: 8, width: 6, height: 6, fontSize: 6, role: 'Ruby' },
    { str: 'です', x: 180, y: 10, width: 12, height: 12, fontSize: 12 },
  ];

  test('ルビを除いた本文だけを縦書きオブジェクトにし、ソースは消えない', () => {
    const body = stripRuby(source);
    expect(body.map((i) => i.str).join('')).not.toContain('ほん');
    expect(joinVerticalBody(source)).toBe('本文です');

    let doc = blankDoc(1);
    doc = apply(doc, {
      type: 'loadPdf',
      opfsPath: 'pdfs/p1/sample.pdf',
      pageCount: 1,
      sourceTextByPage: { 1: source.map((i) => ({ ...i })) },
    });
    const before = JSON.stringify(doc.pdf?.sourceTextByPage[1]);
    doc = apply(doc, {
      type: 'dropPdfTextRange',
      pdfPage: 1,
      range: { x: 0, y: 0, width: 400, height: 400 },
      attachment: { kind: 'pasteboard' },
      box: { x: 10, y: 10, width: 20, height: 80 },
    });
    expect(doc.pasteboardTexts[0].content).toBe('本文です');
    expect(JSON.stringify(doc.pdf?.sourceTextByPage[1])).toBe(before);
    expect(doc.pdf?.extractedGlyphs?.length).toBeGreaterThan(0);

    const textId = doc.pasteboardTexts[0].id;
    doc = apply(doc, { type: 'selectText', textId });
    doc = apply(doc, { type: 'editText', textId, content: '本文です（編集）' });
    expect(doc.pasteboardTexts[0].content).toBe('本文です（編集）');
    expect(JSON.stringify(doc.pdf?.sourceTextByPage[1])).toBe(before);
  });

  test('整形オプションはかぎ括弧を消し句読点を半角スペースにする', () => {
    expect(sanitizeExtractedBody('「本文です。」')).toBe('本文です');
    expect(sanitizeExtractedBody('あ、い。う')).toBe('あ い う');
  });
});

describe('シナリオ: 選択マーキー・クリップ・消しゴム', () => {
  test('ピクセルがページを離れクリップになり、ページへ落とすとベイクされ、拡大回転できる', () => {
    let doc = blankDoc(1);
    const pageId = doc.workspaceOrder[0];
    doc = apply(doc, { type: 'setToolProperties', patch: { penSize: 3, penOpacity: 1, eraserSize: 3 } });
    for (let x = 2; x <= 6; x += 1) {
      doc = apply(doc, {
        type: 'stampInk',
        target: { kind: 'page', pageId },
        x,
        y: 5,
        pressure: 1,
        pointerKind: 'pencil',
        erase: false,
      });
    }
    const pageInk = inkPixelCount(doc.pages[pageId].raster);
    expect(pageInk).toBeGreaterThan(0);

    doc = apply(doc, {
      type: 'marqueeCut',
      pageId,
      rect: { x: 0, y: 0, width: 16, height: 20 },
      workspaceX: 30,
      workspaceY: 4,
    });
    expect(inkPixelCount(doc.pages[pageId].raster)).toBe(0);
    expect(doc.pasteboardClips).toHaveLength(1);
    const clipId = doc.pasteboardClips[0].id;
    expect(inkPixelCount(doc.pasteboardClips[0].raster)).toBe(pageInk);

    doc = apply(doc, { type: 'transformClip', clipId, scale: 1.25, rotation: 0.3, x: 40, y: 8 });
    expect(doc.pasteboardClips[0].scale).toBe(1.25);
    expect(doc.pasteboardClips[0].rotation).toBeCloseTo(0.3);

    doc = apply(doc, { type: 'bakeClipOntoPage', clipId, pageId, pageLocalX: 0, pageLocalY: 0 });
    expect(doc.pasteboardClips).toHaveLength(0);
    expect(inkPixelCount(doc.pages[pageId].raster)).toBeGreaterThan(0);
  });

  test('消しゴムはページインクか選択クリップの画素だけで、テキストは消さない', () => {
    let doc = blankDoc(1);
    const pageId = doc.workspaceOrder[0];
    doc = apply(doc, {
      type: 'createText',
      attachment: { kind: 'page', pageId },
      box: { x: 0, y: 0, width: 8, height: 16 },
      content: '残る',
    });
    doc = apply(doc, {
      type: 'stampInk',
      target: { kind: 'page', pageId },
      x: 8,
      y: 8,
      pressure: 1,
      pointerKind: 'pencil',
      erase: false,
    });
    doc = apply(doc, {
      type: 'stampInk',
      target: { kind: 'page', pageId },
      x: 8,
      y: 8,
      pressure: 1,
      pointerKind: 'pencil',
      erase: true,
    });
    expect(doc.pages[pageId].texts[0].content).toBe('残る');

    doc = apply(doc, {
      type: 'marqueeCut',
      pageId,
      rect: { x: 0, y: 0, width: 4, height: 4 },
      workspaceX: 0,
      workspaceY: 0,
    });
    const clipId = doc.pasteboardClips[0].id;
    doc = apply(doc, {
      type: 'stampInk',
      target: { kind: 'clip', clipId },
      x: 1,
      y: 1,
      pressure: 1,
      pointerKind: 'pencil',
      erase: false,
    });
    const before = inkPixelCount(doc.pasteboardClips[0].raster);
    doc = apply(doc, {
      type: 'stampInk',
      target: { kind: 'clip', clipId },
      x: 1,
      y: 1,
      pressure: 1,
      pointerKind: 'pencil',
      erase: true,
    });
    expect(inkPixelCount(doc.pasteboardClips[0].raster)).toBeLessThan(before);
    expect(doc.pages[pageId].texts[0].content).toBe('残る');
  });
});

describe('シナリオ: テキストツール', () => {
  test('空枠・移動・枠リサイズで文字サイズ・色・台紙とページ所属', () => {
    let doc = blankDoc(1);
    const pageId = doc.workspaceOrder[0];
    doc = apply(doc, { type: 'setToolProperties', patch: { textFontSize: 10, textColor: '#112233' } });
    doc = apply(doc, {
      type: 'createText',
      attachment: { kind: 'pasteboard' },
      box: { x: 5, y: 5, width: 10, height: 20 },
    });
    const textId = doc.pasteboardTexts[0].id;
    expect(doc.pasteboardTexts[0].content).toBe('');
    doc = apply(doc, { type: 'moveText', textId, x: 15, y: 7 });
    expect(doc.pasteboardTexts[0].box.x).toBe(15);
    const oldSize = doc.pasteboardTexts[0].fontSize;
    doc = apply(doc, { type: 'resizeText', textId, box: { x: 15, y: 7, width: 10, height: 40 } });
    expect(doc.pasteboardTexts[0].fontSize).toBe(oldSize * 2);
    doc = apply(doc, { type: 'setTextColor', textId, color: '#FF0000' });
    expect(doc.pasteboardTexts[0].color).toBe('#FF0000');
    doc = apply(doc, {
      type: 'attachTextToPage',
      textId,
      pageId,
      pageBox: { x: 2, y: 2, width: 10, height: 40 },
    });
    expect(doc.pasteboardTexts).toHaveLength(0);
    expect(doc.pages[pageId].texts[0].id).toBe(textId);
    expect(doc.pages[pageId].texts[0].content).toBe('');
    doc = apply(doc, { type: 'moveText', textId, x: 6, y: 8 });
    expect(doc.pages[pageId].texts[0].box.x).toBe(6);
    expect(doc.pages[pageId].texts[0].box.y).toBe(8);
    const pageBox = doc.pages[pageId].texts[0].box;
    const pageFont = doc.pages[pageId].texts[0].fontSize;
    const aspect = pageBox.width / pageBox.height;
    doc = apply(doc, {
      type: 'resizeText',
      textId,
      box: { x: pageBox.x, y: pageBox.y, width: pageBox.width * 2, height: pageBox.height * 2 },
    });
    expect(doc.pages[pageId].texts[0].fontSize).toBe(pageFont * 2);
    expect(
      doc.pages[pageId].texts[0].box.width / doc.pages[pageId].texts[0].box.height,
    ).toBeCloseTo(aspect);
    doc = apply(doc, { type: 'setTextFontSize', textId, fontSize: 24 });
    expect(doc.pages[pageId].texts[0].fontSize).toBe(24);
    doc = apply(doc, { type: 'setTextColor', textId, color: '#00AA00' });
    expect(doc.pages[pageId].texts[0].color).toBe('#00AA00');
  });

  test('空枠と既存文字をページ所属・台紙の両方でキーボード相当に編集できる', () => {
    const factory = ids();
    const run = (state: DocumentState, action: DocumentAction) => reduceTestDocument(state, action, factory);
    let doc = blankDoc(1);
    const pageId = doc.workspaceOrder[0];
    doc = run(doc, {
      type: 'createText',
      attachment: { kind: 'page', pageId },
      box: { x: 1, y: 1, width: 8, height: 20 },
    });
    const pageTextId = doc.pages[pageId].texts[0].id;
    expect(doc.selectedTextId).toBe(pageTextId);
    expect(selectedTextForEditor(doc)).toMatchObject({
      id: pageTextId,
      content: '',
      where: 'page',
      pageId,
    });
    expect(verticalGlyphs('')).toEqual([]);

    doc = run(doc, { type: 'editText', textId: pageTextId, content: 'あ' });
    doc = run(doc, { type: 'editText', textId: pageTextId, content: 'あい' });
    expect(doc.pages[pageId].texts[0].content).toBe('あい');
    expect(selectedTextForEditor(doc)?.content).toBe('あい');
    expect(verticalGlyphs(doc.pages[pageId].texts[0].content)).toEqual(['あ', 'い']);

    doc = run(doc, { type: 'editText', textId: pageTextId, content: '既存を直す' });
    expect(doc.pages[pageId].texts[0].content).toBe('既存を直す');
    expect(verticalGlyphs('既存を直す')).toEqual(['既', '存', 'を', '直', 'す']);

    doc = run(doc, {
      type: 'createText',
      attachment: { kind: 'pasteboard' },
      box: { x: 40, y: 8, width: 10, height: 24 },
    });
    const pasteId = doc.pasteboardTexts[0].id;
    expect(pasteId).not.toBe(pageTextId);
    expect(selectedTextForEditor(doc)).toMatchObject({ id: pasteId, content: '', where: 'pasteboard' });
    doc = run(doc, { type: 'editText', textId: pasteId, content: '台紙本文' });
    expect(doc.pasteboardTexts[0].content).toBe('台紙本文');
    expect(doc.pages[pageId].texts[0].content).toBe('既存を直す');
    expect(findText(doc, pageTextId)?.where).toBe('page');
    expect(findText(doc, pasteId)?.where).toBe('pasteboard');

    let history = createHistory(doc);
    history = reduceHistory(history, { type: 'editText', textId: pasteId, content: '台紙本文改' }, factory);
    expect(history.present.pasteboardTexts[0].content).toBe('台紙本文改');
    history = reduceHistory(history, { type: 'undo' }, factory);
    expect(history.present.pasteboardTexts[0].content).toBe('台紙本文');
  });
});

describe('シナリオ: 自動保存とプロジェクト一覧', () => {
  test('新規・開く・改名・削除', async () => {
    const store = createMemoryStore();
    let doc = blankDoc(2, '初稿');
    await saveProject(store, doc, '2026-01-01T00:00:00.000Z');
    expect((await listProjects(store)).map((p) => p.name)).toEqual(['初稿']);

    const opened = await loadProject(store, doc.projectId);
    expect(opened?.workspaceOrder).toHaveLength(2);

    await renameProject(store, doc.projectId, '改題', '2026-01-02T00:00:00.000Z');
    expect((await listProjects(store))[0].name).toBe('改題');
    expect((await loadProject(store, doc.projectId))?.name).toBe('改題');

    await deleteProject(store, doc.projectId);
    expect(await listProjects(store)).toEqual([]);
    expect(await loadProject(store, doc.projectId)).toBeNull();
  });

  test('履歴はセッション内だけで、保存データには乗らない', () => {
    const doc = blankDoc(1);
    let history = createHistory(doc);
    const factory = ids();
    history = reduceHistory(history, { type: 'appendPage' }, factory);
    expect(history.past).toHaveLength(1);
    history = reduceHistory(history, { type: 'undo' }, factory);
    expect(history.present.workspaceOrder).toHaveLength(1);
    history = reduceHistory(history, { type: 'redo' }, factory);
    expect(history.present.workspaceOrder).toHaveLength(2);
  });
});

describe('シナリオ: ポインタ分担（指はパン、ペンはインク）', () => {
  test('指はパン／長押し並べ替え、Apple Pencil はツールに従う', () => {
    expect(resolvePointerIntent('pen', { kind: 'finger', phase: 'move' })).toEqual({ type: 'pan' });
    expect(resolvePointerIntent('select', { kind: 'finger', phase: 'move' })).toEqual({ type: 'pan' });
    expect(resolvePointerIntent('pen', { kind: 'finger', phase: 'longpress' })).toEqual({
      type: 'longPressReorder',
    });
    expect(resolvePointerIntent('pen', { kind: 'pencil', phase: 'move' })).toEqual({ type: 'drawInk' });
    expect(resolvePointerIntent('eraser', { kind: 'pencil', phase: 'down' })).toEqual({ type: 'eraseInk' });
    expect(resolvePointerIntent('text', { kind: 'pencil', phase: 'down' })).toEqual({ type: 'textEdit' });
    expect(resolvePointerIntent('select', { kind: 'pencil', phase: 'move' })).toEqual({
      type: 'selectMarquee',
    });
    expect(brushRadius(4, 0.5, 'pencil')).toBe(2);
    expect(brushRadius(4, 0.5, 'finger')).toBe(4);
    expect(resolvePointerIntent('pen', { kind: 'pencil', phase: 'longpress' })).toEqual({ type: 'drawInk' });
    expect(resolvePointerIntent('select', { kind: 'finger', phase: 'longpress' })).toEqual({
      type: 'longPressReorder',
    });
    expect(workspacePointerPolicy('finger')).toMatchObject({ pan: true, grabPage: true, ink: false });
    expect(workspacePointerPolicy('pencil')).toMatchObject({ ink: true, pan: false });
    expect(pdfPointerPolicy('finger').rangeSelect).toBe(true);
    expect(pdfPointerPolicy('pencil').rangeSelect).toBe(true);
    expect(stockPointerPolicy('finger')).toEqual({ pan: true, dragPage: true });
    expect(stockPointerPolicy('pencil')).toEqual({ pan: false, dragPage: false });
  });
});

describe('シナリオ: PDF ページ送りでビューア key が差し替わる', () => {
  test('ページ番号と generation が変わると key が変わる', () => {
    expect(pdfPageViewerKey('pdfs/p1.pdf', 1, 1)).not.toBe(pdfPageViewerKey('pdfs/p1.pdf', 2, 1));
    expect(pdfPageViewerKey('pdfs/p1.pdf', 2, 1)).toContain('#page=2');
    expect(pdfPageViewerKey('pdfs/p1.pdf', 1, 2)).not.toBe(pdfPageViewerKey('pdfs/p1.pdf', 1, 1));

    let doc = blankDoc(1);
    doc = apply(doc, {
      type: 'loadPdf',
      opfsPath: 'pdfs/p1/novel.pdf',
      pageCount: 4,
      sourceTextByPage: { 1: [], 2: [], 3: [], 4: [] },
    });
    expect(doc.pdf?.currentPage).toBe(1);
    doc = apply(doc, { type: 'setPdfView', currentPage: 3 });
    expect(doc.pdf?.currentPage).toBe(3);
    expect(pdfPageViewerKey(doc.pdf!.opfsPath, doc.pdf!.currentPage, doc.pdf!.generation)).toContain('#page=3');
    doc = apply(doc, {
      type: 'loadPdf',
      opfsPath: 'pdfs/p1/novel.pdf',
      pageCount: 4,
      sourceTextByPage: { 1: [], 2: [], 3: [], 4: [] },
    });
    expect(doc.pdf?.currentPage).toBe(3);
  });
});

describe('シナリオ: 分割・PDF表示・サイドバー縮小は保存される', () => {
  test('スプリット比と PDF の隠す／出す、縮小、ストック整列', async () => {
    expect(nextSplitFromDrag(0.5, 40, 200)).toBeCloseTo(0.7);
    expect(nextSplitFromDrag(0.5, -1000, 200)).toBe(SPLIT_MIN);
    expect(nextSplitFromDrag(0.5, 1000, 200)).toBe(SPLIT_MAX);

    let doc = blankDoc(2);
    const kept = 0.4;
    doc = apply(doc, { type: 'setUiLayout', workspacePdfSplit: kept, paletteStockSplit: 0.3 });
    doc = apply(doc, { type: 'setUiLayout', pdfViewerVisible: false });
    expect(mainPaneFlex(doc)).toEqual({ workspace: 1, pdf: 0 });
    expect(doc.workspacePdfSplit).toBe(kept);
    doc = apply(doc, { type: 'setUiLayout', pdfViewerVisible: true });
    expect(mainPaneFlex(doc).workspace).toBe(kept);
    expect(mainPaneFlex(doc).pdf).toBeCloseTo(1 - kept);
    doc = apply(doc, { type: 'setUiLayout', sidebarCompact: true, stockLayout: 'grid' });
    expect(doc.sidebarCompact).toBe(true);
    expect(doc.stockLayout).toBe('grid');
    doc = apply(doc, {
      type: 'setUiLayout',
      pagesPerColumn: 3,
      pairGap: 24,
      showPairDivider: true,
      columnGap: 80,
    });
    expect(doc.pagesPerColumn).toBe(3);
    expect(doc.pairGap).toBe(24);
    expect(doc.showPairDivider).toBe(true);
    expect(doc.columnGap).toBe(80);

    const store = createMemoryStore();
    await saveProject(store, doc, '2026-08-28T00:00:00.000Z');
    const loaded = await loadProject(store, doc.projectId);
    expect(loaded?.workspacePdfSplit).toBe(kept);
    expect(loaded?.pdfViewerVisible).toBe(true);
    expect(loaded?.sidebarCompact).toBe(true);
    expect(loaded?.stockLayout).toBe('grid');
    expect(loaded?.paletteStockSplit).toBe(0.3);
    expect(loaded?.pagesPerColumn).toBe(3);
    expect(loaded?.pairGap).toBe(24);
    expect(loaded?.showPairDivider).toBe(true);
    expect(loaded?.columnGap).toBe(80);

    let history = createHistory(doc);
    const factory = ids();
    history = reduceHistory(history, { type: 'setUiLayout', workspacePdfSplit: 0.7 }, factory);
    expect(history.past).toHaveLength(0);
  });
});

describe('シナリオ: sample.pdf を実ファイルから読む', () => {
  test('見開き PDF の本文からルビを除ける', () => {
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const result = spawnSync('node', [join(__dirname, '../../../scripts/dump-pdf.mjs')], {
      encoding: 'utf8',
      cwd: join(__dirname, '../../..'),
    });
    const raw = result.stdout;
    const jsonStart = raw.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const dumped = JSON.parse(raw.slice(jsonStart)) as {
      pageCount: number;
      pages: Array<{ items: PdfTextItem[] }>;
    };
    expect(dumped.pageCount).toBe(1);
    const rawItems = dumped.pages[0].items;
    const all = rawItems.map((item) => ({
      ...item,
      fontSize: Math.min(
        ...[item.width, item.height, item.fontSize].filter((n) => n > 0 && n < 40),
        item.fontSize || 12,
      ),
    }));
    expect(all.some((i) => i.str.includes('ローレンティア'))).toBe(true);
    const joined = joinVerticalBody(all);
    expect(joined).toContain('ローレンティア');
    expect(joined).not.toContain('すが');
    expect(joined).not.toContain('うた');
    const sourceCopy = all.map((i) => ({ ...i }));
    stripRuby(all);
    expect(all.map((i) => i.str).join('')).toBe(sourceCopy.map((i) => i.str).join(''));

    const bytes = new Uint8Array(readFileSync(join(__dirname, '../../../sample/sample.pdf')));
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
