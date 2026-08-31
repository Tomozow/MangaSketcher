import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';

import { createDocument, createEditorDocument, sequentialIds } from '../../domain/document';
import { joinVerticalBody, stripRuby } from '../../domain/pdfText';
import { pdfPageViewerKey } from '../../domain/pdfView';
import { brushRadius } from '../../domain/pointers';
import { reduceTestDocument, type DocumentAction } from '../../domain/reducer';
import type { PdfTextItem } from '../../domain/types';
import { LONG_PRESS_MS, canGrabPage } from '../../domain/workspaceGestures';
import { AutosaveManager } from '../../storage/autosave';
import { loadEditorBoot } from '../../storage/editorBoot';
import { createProject, writeProjectPdf } from '../../storage/projectStore';
import { pdfOpfsPath } from '../../storage/rasterIds';
import { applyPdfViewSession } from '../../storage/pdfViewSession';
import { MemoryStorageDatabase } from '../../storage/testUtils/memoryDb';
import { MemoryOpfsStorage } from '../../storage/testUtils/memoryOpfs';
import { historyControlsDisabled } from '../historyControls';
import { WORKSPACE_TOUCH_ACTION, createWorkspaceGestureStore } from '../gestures/types';
import { getWorkspaceSession, stepWorkspacePointer } from '../gestures/workspaceFsm';
import { countAlphaPixels, FakeOffscreenCanvas } from '../ink/fakeCanvas';
import { InkEngine } from '../ink/InkEngine';
import { drawBrushStroke } from '../ink/strokeDraw';
import { createPdfGestureStore, stepPdfPointer } from '../pdf/pdfGestureFsm';
import { moveWorkspacePageToStock } from '../stock/stockActions';
import { planTextCommit } from '../textEditCommit';
import { pageBoxToWorld, textPoseAfterWorldMove } from '../gestures/elementInteraction';
import { buildStripFrames } from '../../domain/stripGeometry';

const here = dirname(fileURLToPath(import.meta.url));
const editorCss = readFileSync(join(here, '../editor.css'), 'utf8');
const pageTextOverlaySrc = readFileSync(join(here, '../PageTextOverlay.tsx'), 'utf8');
const textEditBarSrc = readFileSync(join(here, '../TextEditBar.tsx'), 'utf8');
const editorLayoutSrc = readFileSync(join(here, '../EditorLayout.tsx'), 'utf8');
const workspaceStripSrc = readFileSync(join(here, '../WorkspaceStrip.tsx'), 'utf8');
const pageInkOverlaySrc = readFileSync(join(here, '../PageInkOverlay.tsx'), 'utf8');

const pageHit = {
  kind: 'page' as const,
  pageId: 'p1',
  localX: 10,
  localY: 10,
  readingIndex: 0,
  insertIndex: 0,
};

const noopClip = {
  rasterWidth: 1200,
  rasterHeight: 1700,
  getClipMeta: () => undefined,
  getClipRasterSize: () => ({ width: 20, height: 20 }),
};

function finger(
  store: ReturnType<typeof createWorkspaceGestureStore>,
  phase: 'down' | 'move' | 'up',
  overrides: Partial<Parameters<typeof stepWorkspacePointer>[1]> = {},
) {
  return stepWorkspacePointer(store, {
    pointerId: 1,
    kind: 'finger',
    phase,
    tool: 'pen',
    x: 0,
    y: 0,
    pressure: 1,
    hit: pageHit,
    now: 1,
    isPrimary: true,
    selectedPageId: null,
    selectedClipId: null,
    ...noopClip,
    ...overrides,
  });
}

function pencil(
  store: ReturnType<typeof createWorkspaceGestureStore>,
  phase: 'down' | 'move' | 'up',
  overrides: Partial<Parameters<typeof stepWorkspacePointer>[1]> = {},
) {
  return stepWorkspacePointer(store, {
    pointerId: 10,
    kind: 'pencil',
    phase,
    tool: 'pen',
    x: 4,
    y: 5,
    pressure: 0.6,
    hit: pageHit,
    now: 1,
    isPrimary: true,
    selectedPageId: null,
    selectedClipId: null,
    ...noopClip,
    ...overrides,
  });
}

function createTestEngine(w = 64, h = 64) {
  return new InkEngine({
    rasterWidth: w,
    rasterHeight: h,
    emptyPng: new ArrayBuffer(0),
    canvasFactory: (width, height) =>
      new FakeOffscreenCanvas(width, height) as unknown as OffscreenCanvas,
    encodePng: async (canvas) => {
      const blob = await (canvas as unknown as FakeOffscreenCanvas).convertToBlob();
      return blob.arrayBuffer();
    },
  });
}

describe('§13.2 実機利用シナリオ（自動契約。Pencil 実機合格とは呼ばない）', () => {
  test('1. Pencil 描画中に指パンが並立し、互いの mode を奪わない', () => {
    const store = createWorkspaceGestureStore();
    pencil(store, 'down');
    expect(getWorkspaceSession(store, 10)?.mode).toBe('penOverlay');

    finger(store, 'down', { pointerId: 2, x: 0, y: 0, now: 1 });
    const pan = finger(store, 'move', { pointerId: 2, x: 40, y: 0, now: 2 });
    expect(getWorkspaceSession(store, 2)?.mode).toBe('pan');
    expect(pan.effects[0]).toMatchObject({ type: 'panBy', dx: 40 });

    const ink = pencil(store, 'move', { x: 20, y: 8, now: 3 });
    expect(getWorkspaceSession(store, 10)?.mode).toBe('penOverlay');
    expect(getWorkspaceSession(store, 2)?.mode).toBe('pan');
    expect(ink.effects[0]).toMatchObject({
      type: 'penOverlayMove',
      points: [{ x: pageHit.localX, y: pageHit.localY }],
    });
    expect(ink.effects.some((e) => e.type === 'panBy')).toBe(false);
  });

  test('2. Pencil 長押しではページを掴まない', () => {
    expect(canGrabPage('pencil', 'longpress')).toBe(false);
    const store = createWorkspaceGestureStore();
    pencil(store, 'down', { now: 0, x: 4, y: 5 });
    const held = pencil(store, 'move', { now: LONG_PRESS_MS + 80, x: 6, y: 6 });
    expect(held.effects.some((e) => e.type === 'grabPage')).toBe(false);
    expect(getWorkspaceSession(store, 10)?.mode).toBe('penOverlay');
  });

  test('3. 指 420ms 後にドラッグすると grabPage、ストック MOVE で隙間が閉じる', () => {
    const store = createWorkspaceGestureStore();
    finger(store, 'down', { x: 0, y: 0, now: 0 });
    const held = finger(store, 'move', { x: 2, y: 0, now: LONG_PRESS_MS + 1 });
    expect(held.effects.some((e) => e.type === 'grabPage')).toBe(false);
    const grab = finger(store, 'move', { x: 20, y: 0, now: LONG_PRESS_MS + 20 });
    expect(grab.effects).toContainEqual({ type: 'grabPage', pageId: 'p1', fromIndex: 0 });

    let doc = createDocument({
      projectId: 'p1',
      name: 'stock',
      pageCount: 2,
      rasterWidth: 16,
      rasterHeight: 20,
      ids: sequentialIds('page'),
    });
    const [first, second] = doc.workspaceOrder;
    const actions = moveWorkspacePageToStock(first, 0, 8, 8, doc.rasterWidth, doc.rasterHeight);
    for (const action of actions) {
      doc = reduceTestDocument(doc, action as DocumentAction, sequentialIds('mv'));
    }
    expect(doc.workspaceOrder).toEqual([second]);
    expect(doc.stock).toHaveLength(1);
  });

  test('4. ワークスペースは touch-action:none（ブラウザズームに渡さない）', () => {
    expect(WORKSPACE_TOUCH_ACTION).toBe('none');
    expect(editorCss).toMatch(/\.ms-workspaceSurface[^{]*\{[^}]*touch-action:\s*none/);
  });

  test('5. 縦横同じ 4 ペインツリー（狭い縦向きは仕様）', () => {
    expect(editorLayoutSrc).toContain('data-ms-region="workspace"');
    expect(editorLayoutSrc).toContain('data-ms-region="pdf"');
    expect(editorLayoutSrc).toContain('data-ms-region="tools"');
    expect(editorLayoutSrc).toContain('data-ms-region="stock"');
    expect(editorLayoutSrc).toContain('aria-label="ワークスペース"');
    expect(editorLayoutSrc).toContain('aria-label="ツール"');
    expect(editorLayoutSrc).toContain('aria-label="ストック"');
    expect(editorLayoutSrc).toContain('aria-label="PDF"');
    expect(editorLayoutSrc).not.toContain('data-ms-shell="pane-label"');
    expect(editorCss).toMatch(/\.ms-body\s*\{[^}]*display:\s*flex/);
    expect(editorCss).not.toMatch(/@media[^{]+\{[^}]*\.ms-pane[^}]*display:\s*none/);
  });

  test('ページ線画はページ枠内でテキストより下に描く', () => {
    expect(workspaceStripSrc).toMatch(/PAGE_INK_PLANE_ATTR[\s\S]*PageInkCanvas/);
    expect(editorCss).toMatch(/\.ms-pageInkPlane[^{]*\{[^}]*z-index:\s*1/);
    expect(editorCss).toMatch(/\.ms-pageTextWrap[^{]*\{[^}]*z-index:\s*2/);
  });

  test('ページ番号タップの選択肢に線画削除がある', () => {
    const pageChromeSrc = readFileSync(join(here, '../PageDeleteButton.tsx'), 'utf8');
    expect(pageChromeSrc).toContain('線画を削除');
    expect(workspaceStripSrc).toContain('onClearPageInk');
    expect(editorLayoutSrc).not.toContain('このページの線画を削除しますか？');
    expect(editorLayoutSrc).toContain('ゴミ箱を空にしますか？');
  });

  test('クリップ選択時は削除と複製ボタンを上に出す', () => {
    expect(pageInkOverlaySrc).toContain('クリップを削除');
    expect(pageInkOverlaySrc).toContain('クリップを複製');
    expect(pageInkOverlaySrc).toContain('クリップをコマに挿入');
    expect(pageInkOverlaySrc).toContain('ClipChromeOverlay');
    expect(pageInkOverlaySrc).toContain('metrics.stack');
  });

  test('クリップは透明背景の四角枠で線画と区別する', () => {
    expect(editorCss).toMatch(/\.ms-clipFrame[^{]*\{[^}]*background:\s*transparent/);
    expect(editorCss).toMatch(/\.ms-clipFrame[^{]*\{[^}]*border:\s*1\.5px solid/);
    expect(editorCss).not.toMatch(/\.ms-clipFrame[^{]*\{[^}]*background:\s*#fff/);
    expect(editorCss).not.toMatch(/\.ms-clipFrame[^{]*\{[^}]*background:\s*white/);
  });

  test('選択ツールはテキスト・線画・クリップの対象切替を持つ', () => {
    const sidebarSrc = readFileSync(join(here, '../CompactSidebar.tsx'), 'utf8');
    expect(sidebarSrc).toContain("label: 'テキスト'");
    expect(sidebarSrc).toContain("label: '線画'");
    expect(sidebarSrc).toContain("label: 'クリップ'");
    expect(sidebarSrc).toContain('setTextsFontSize');
    expect(sidebarSrc).toContain('setFlyoutOpen');
    expect(sidebarSrc).toContain('toolFlyoutOnFirstTap');
  });

  test('ワークスペース左に拡大縮小とページ移動のナビがある', () => {
    const navSrc = readFileSync(join(here, '../WorkspaceNav.tsx'), 'utf8');
    expect(editorLayoutSrc).toContain('WorkspaceNav');
    expect(navSrc).toContain('aria-label="ズームイン"');
    expect(navSrc).toContain('aria-label="ズームアウト"');
    expect(navSrc).toContain('前の${pageStepLabel}');
    expect(navSrc).toContain('次の${pageStepLabel}');
    expect(navSrc).toContain('spreadWorldRectForPage');
    expect(editorCss).toMatch(/\.ms-leftChrome[^{]*\{[^}]*top:\s*50%/);
    expect(editorCss).toMatch(/\.ms-workspaceNav[^{]*\{[^}]*grid-row:\s*1/);
    expect(editorCss).toMatch(/\.ms-toolRail[^{]*\{[^}]*grid-row:\s*2/);
  });

  test('選択の一括移動は着地先でテキスト所属を付け替える', () => {
    const controllerSrc = readFileSync(join(here, '../useEditorController.ts'), 'utf8');
    expect(controllerSrc).toContain('textPoseAfterWorldMove');
    expect(controllerSrc).toContain('attachment:');

    const { frames } = buildStripFrames(['p1', 'p2']);
    const page1 = frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === 'p1')!;
    const page2 = frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === 'p2')!;
    const sourceBox = { x: 120, y: 340, width: 96, height: 425 };
    const world = pageBoxToWorld(page1, sourceBox, 1200, 1700);
    const offPage = textPoseAfterWorldMove({
      sourceWhere: 'page',
      sourcePageId: 'p1',
      sourceBox,
      sourceFontSize: 24,
      worldX: page1.x + page1.width + 8,
      worldY: world.y,
      frames,
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    expect(offPage.attachment).toEqual({ kind: 'pasteboard' });
    const otherPage = textPoseAfterWorldMove({
      sourceWhere: 'page',
      sourcePageId: 'p1',
      sourceBox,
      sourceFontSize: 24,
      worldX: page2.x + 12,
      worldY: page2.y + 16,
      frames,
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    expect(otherPage.attachment).toEqual({ kind: 'page', pageId: 'p2' });
  });

  test('6. 確定は explicit のみ。ページ上は textarea ではなく表示専用', () => {
    expect(pageTextOverlaySrc).not.toMatch(/<textarea/i);
    expect(pageTextOverlaySrc).toContain('pageTextBox');
    expect(editorCss).toMatch(/\.ms-pageTextBox[^{]*\{[^}]*writing-mode:\s*vertical-rl/);
    expect(editorCss).toMatch(/\.ms-pageTextBox[^{]*\{[^}]*I-OTFアンチックStd B/);
    expect(textEditBarSrc).toMatch(/<textarea/);
    expect(textEditBarSrc).not.toContain('完了');
    expect(textEditBarSrc).toContain('PAGE_TEXT_CONFIRM_ATTR');
    expect(pageTextOverlaySrc).toContain('テキストを確定');
    expect(textEditBarSrc).toContain('PAGE_TEXT_WRAP_ATTR');
    expect(editorLayoutSrc).toContain(
      "doc.tool === 'text' && selectedTextIdsOf(doc).length <= 1 ? textSelection : null",
    );
    expect(workspaceStripSrc).toContain('tool === \'text\' || (tool === \'select\' && resolvedSelectTargets.text)');
    expect(
      planTextCommit({
        draft: '確定文',
        savedContent: '',
        composing: false,
        explicit: true,
      }),
    ).toEqual({ kind: 'commit', content: '確定文' });
    expect(
      planTextCommit({
        draft: '確定文',
        savedContent: '',
        composing: false,
        explicit: false,
      }),
    ).toEqual({ kind: 'skip', reason: 'not-explicit' });
  });

  test('PDF 表示中は別の PDF を開ける', () => {
    const paneSrc = readFileSync(join(here, '../pdf/PdfPane.tsx'), 'utf8');
    const viewerSrc = readFileSync(join(here, '../pdf/PdfPageViewer.tsx'), 'utf8');
    expect(paneSrc).toContain('別のPDF');
    expect(viewerSrc).toContain('pdfNavPrimary');
    expect(viewerSrc).toContain('pdfNavPrimaryEnd');
    expect(viewerSrc).toContain('pdfNavTools');
    expect(editorLayoutSrc).not.toContain('pdfDrawerHead');
    expect(editorLayoutSrc).toContain('PdfDrawerResizeHandle');
    expect(editorCss).toMatch(
      /\[data-ms-chrome-flip='1'\][\s\S]*\.ms-pdfNavPrimaryEnd[\s\S]*order:\s*1/,
    );
  });

  test('PDF ナビにズームイン／アウトがある', () => {
    const viewerSrc = readFileSync(join(here, '../pdf/PdfPageViewer.tsx'), 'utf8');
    expect(viewerSrc).toContain('aria-label="ズームアウト"');
    expect(viewerSrc).toContain('aria-label="ズームイン"');
    expect(viewerSrc).toContain('nudgeZoom');
  });

  test('7. PDF ページ送りで key が変わり、リロードで page/zoom/pan が残る', async () => {
    expect(pdfPageViewerKey('pdfs/a.pdf', 1, 1)).not.toBe(pdfPageViewerKey('pdfs/a.pdf', 2, 1));

    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('pdf-view', 1, { db, opfs });
    await writeProjectPdf(document.projectId, Uint8Array.from([37, 80, 68]).buffer, { db, opfs });
    document.pdf = {
      pageCount: 4,
      currentPage: 2,
      zoom: 1.4,
      panX: 12,
      panY: -8,
      sourceTextByPage: {},
      opfsPath: pdfOpfsPath(document.projectId),
      generation: 3,
    };
    await db.putDocument(document);

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.pdf?.currentPage).toBe(2);
    expect(boot?.document.pdf?.zoom).toBe(1.4);
    expect(boot?.document.pdf?.panX).toBe(12);
    expect(boot?.document.pdf?.panY).toBe(-8);
    expect(boot?.document.pdf?.generation).toBe(3);

    const restored = applyPdfViewSession(boot!.document, {
      currentPage: 4,
      zoom: 2,
      panX: 0,
      panY: 1,
      fingerprint: 'novel.pdf:1:1',
    });
    expect(restored.pdf?.currentPage).toBe(4);
    expect(restored.pdf?.zoom).toBe(2);
  });

  test('8. 範囲ドロップはルビを落とし原文を残す。1 本指はパンできる', () => {
    const source: PdfTextItem[] = [
      { str: '本', x: 200, y: 24, width: 12, height: 12, fontSize: 12 },
      { str: '文', x: 200, y: 10, width: 12, height: 12, fontSize: 12 },
      { str: 'ほん', x: 212, y: 8, width: 6, height: 6, fontSize: 6, role: 'Ruby' },
      { str: 'です', x: 180, y: 24, width: 12, height: 12, fontSize: 12 },
    ];
    const before = JSON.stringify(source);
    expect(joinVerticalBody(source)).toBe('本文です');
    expect(stripRuby(source).map((item) => item.str).join('')).not.toContain('ほん');
    expect(JSON.stringify(source)).toBe(before);

    const pdfStore = createPdfGestureStore();
    stepPdfPointer(pdfStore, {
      pointerId: 1,
      kind: 'finger',
      phase: 'down',
      x: 0,
      y: 0,
      now: 0,
      panX: 0,
      panY: 0,
    });
    stepPdfPointer(pdfStore, {
      pointerId: 1,
      kind: 'finger',
      phase: 'up',
      x: 2,
      y: 0,
      now: 100,
      panX: 0,
      panY: 0,
    });
    const pan = stepPdfPointer(pdfStore, {
      pointerId: 1,
      kind: 'finger',
      phase: 'down',
      x: 0,
      y: 0,
      now: 200,
      panX: 4,
      panY: 5,
    });
    const moved = stepPdfPointer(pdfStore, {
      pointerId: 1,
      kind: 'finger',
      phase: 'move',
      x: 40,
      y: 0,
      now: 280,
      panX: 4,
      panY: 5,
    });
    expect(pan).toEqual([]);
    expect(moved.some((e) => e.type === 'pdfPan')).toBe(true);
  });

  test('9. ベイク後 encodedPng を hidden flush し、エンコード中は未保存ドット', async () => {
    const rasterId = 'p1:page:a';
    const engine = createTestEngine();
    engine.registerRaster(rasterId);
    const overlay = engine.beginPenOverlay(rasterId);
    overlay.fillStyle = '#000000';
    overlay.fillRect(4, 4, 10, 10);
    engine.bakePenOverlay(rasterId);

    await vi.waitFor(() => {
      expect(engine.encodedPng.get(rasterId)?.byteLength).toBeGreaterThan(0);
    });

    const db = new MemoryStorageDatabase();
    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => engine.encodedPng,
    });
    manager.notifyEncodingStarted(rasterId);
    expect(manager.getStatus()).toEqual({ unsaved: true, encodingCount: 1 });
    manager.notifyEncodingComplete(rasterId);
    expect(manager.getStatus().encodingCount).toBe(0);

    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'ink',
      pageCount: 1,
      rasterWidth: 64,
      rasterHeight: 64,
      ids: sequentialIds('page'),
    });
    manager.scheduleSave(doc, [rasterId], false);
    manager.flushHidden();
    await vi.waitFor(async () => {
      const stored = await db.getRaster(rasterId);
      expect(stored?.byteLength).toBeGreaterThan(0);
    });
    manager.dispose();
  });

  test('10. コンパクトの undo は IME 中 disabled。色・サイズはツール状態に存在する', () => {
    expect(historyControlsDisabled(true, 3)).toBe(true);
    expect(historyControlsDisabled(false, 3)).toBe(false);
    expect(historyControlsDisabled(false, 0)).toBe(true);
    const doc = createEditorDocument({
      projectId: 'p1',
      name: 'ui',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    expect(doc.tools.penSize).toBe(12);
    expect(doc.tools.penColor).toBe('#1A1A1A');
    expect(editorLayoutSrc).toContain('CompactSidebar');
  });

  test('11. 消しゴムはベイク済みの線を page canvas から消す', () => {
    const rasterId = 'p1:page:baked';
    const engine = createTestEngine();
    engine.registerRaster(rasterId);
    const overlay = engine.beginPenOverlay(rasterId);
    overlay.fillStyle = '#000000';
    overlay.fillRect(10, 10, 16, 16);
    engine.bakePenOverlay(rasterId);
    const baked = countAlphaPixels(engine.getHotContext(rasterId)!, 64, 64);
    expect(baked).toBeGreaterThan(0);

    const eraseCtx = engine.beginEraseDirect(rasterId);
    drawBrushStroke(
      eraseCtx,
      [{ x: 18, y: 18, pressure: 1 }],
      {
        color: '#000000',
        lineWidth: brushRadius(28, 1, 'pencil') * 2,
        globalAlpha: 1,
        composite: 'destination-out',
      },
    );
    engine.finishEraseDirect(rasterId);
    const after = countAlphaPixels(engine.getHotContext(rasterId)!, 64, 64);
    expect(after).toBeLessThan(baked);
  });
});
