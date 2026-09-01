import { describe, expect, test, vi } from 'vitest';
import { LONG_PRESS_MS, canGrabPage } from '../../../domain/workspaceGestures';
import { buildStripFrames, pageLocalFromWorld } from '../../../domain/stripGeometry';
import { rasterGrabOffsetToWorld } from '../pageInkDom';
import {
  countActiveTouches,
  getWorkspaceSession,
  reorderTargetIndex,
  stepWorkspacePointer,
} from '../workspaceFsm';
import { createWorkspaceGestureStore } from '../types';
import { reduceWorkspaceEffects } from '../workspaceEffects';
import { clientOverStockPane } from '../../stock/stockCoords';

vi.mock('../../stock/stockCoords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stock/stockCoords')>();
  return {
    ...actual,
    clientOverStockPane: vi.fn((x: number, y: number) => actual.clientOverStockPane(x, y)),
  };
});

const pageHit = {
  kind: 'page' as const,
  pageId: 'p1',
  localX: 10,
  localY: 10,
  readingIndex: 0,
  insertIndex: 0,
};

const pageText = {
  kind: 'pageText' as const,
  textId: 'tx',
  pageId: 'p1',
  localX: 5,
  localY: 5,
  grabOffsetX: 2,
  grabOffsetY: 3,
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
  phase: 'down' | 'move' | 'up' | 'cancel',
  overrides: Partial<Parameters<typeof stepWorkspacePointer>[1]> = {},
) {
  const x = overrides.x ?? 0;
  const y = overrides.y ?? 0;
  return stepWorkspacePointer(store, {
    pointerId: 1,
    kind: 'finger',
    phase,
    tool: 'pen',
    x,
    y,
    worldX: overrides.worldX ?? x,
    worldY: overrides.worldY ?? y,
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
  phase: 'down' | 'move' | 'up' | 'cancel',
  overrides: Partial<Parameters<typeof stepWorkspacePointer>[1]> = {},
) {
  const x = overrides.x ?? 4;
  const y = overrides.y ?? 5;
  return stepWorkspacePointer(store, {
    pointerId: 10,
    kind: 'pencil',
    phase,
    tool: 'pen',
    x,
    y,
    worldX: overrides.worldX ?? x,
    worldY: overrides.worldY ?? y,
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

function pencilText(
  store: ReturnType<typeof createWorkspaceGestureStore>,
  phase: 'down' | 'move' | 'up' | 'cancel',
  overrides: Partial<Parameters<typeof stepWorkspacePointer>[1]> = {},
) {
  const x = overrides.x ?? 4;
  const y = overrides.y ?? 5;
  return stepWorkspacePointer(store, {
    pointerId: 10,
    kind: 'pencil',
    phase,
    tool: 'text',
    x,
    y,
    worldX: overrides.worldX ?? x,
    worldY: overrides.worldY ?? y,
    pressure: 0.6,
    hit: pageText,
    now: 1,
    isPrimary: true,
    selectedPageId: null,
    selectedClipId: null,
    ...noopClip,
    ...overrides,
  });
}

describe('Web workspace FSM', () => {
  test('canGrabPage: pencil は掴まない', () => {
    expect(canGrabPage('pencil', 'longpress')).toBe(false);
    expect(canGrabPage('finger', 'longpress')).toBe(true);
  });

  describe('番号 tap / +', () => {
    test('pending up → 未選択なら selectPage', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', {
        hit: { kind: 'pageNumber', pageId: 'p2', readingIndex: 1 },
        now: 100,
      });
      const up = finger(store, 'up', {
        hit: { kind: 'pageNumber', pageId: 'p2', readingIndex: 1 },
        now: 150,
      });
      expect(up.effects).toEqual([
        { type: 'selectPage', pageId: 'p2' },
        { type: 'showPageDelete', pageId: 'p2' },
      ]);
    });

    test('pending up → 番号帯タップで挿入・削除ボタンを出す', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', {
        hit: { kind: 'pageNumber', pageId: 'p2', readingIndex: 1 },
        selectedPageId: 'p2',
        now: 100,
      });
      const up = finger(store, 'up', {
        hit: { kind: 'pageNumber', pageId: 'p2', readingIndex: 1 },
        selectedPageId: 'p2',
        now: 150,
      });
      expect(up.effects).toEqual([
        { type: 'selectPage', pageId: 'p2' },
        { type: 'showPageDelete', pageId: 'p2' },
      ]);
      expect(up.effects.some((e) => e.type === 'appendPage' || e.type === 'insertAfterSelected')).toBe(
        false,
      );
    });

    test('余白スロット tap ではページを作らない', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { hit: { kind: 'slot', insertIndex: 0 }, now: 100 });
      const up = finger(store, 'up', { hit: { kind: 'slot', insertIndex: 0 }, now: 150 });
      expect(up.effects.some((e) => e.type === 'appendPage' || e.type === 'insertAfterSelected')).toBe(
        false,
      );
    });

    test('pending up on + → appendPage', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { hit: { kind: 'append' }, now: 100 });
      const up = finger(store, 'up', { hit: { kind: 'append' }, now: 150 });
      expect(up.effects).toEqual([{ type: 'appendPage' }]);
    });

    test('text tool でも + の tap は appendPage する', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { tool: 'text', hit: { kind: 'append' }, now: 100 });
      const up = finger(store, 'up', { tool: 'text', hit: { kind: 'append' }, now: 150 });
      expect(up.effects).toEqual([{ type: 'appendPage' }]);
    });

    test('text tool: ページ外 empty なら台紙に createText する', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', {
        tool: 'text',
        hit: { kind: 'empty' },
        worldX: 120,
        worldY: 240,
        now: 100,
      });
      const up = finger(store, 'up', {
        tool: 'text',
        hit: { kind: 'empty' },
        worldX: 120,
        worldY: 240,
        now: 150,
      });
      expect(up.effects).toEqual([{ type: 'createText', pasteboard: true, x: 120, y: 240 }]);
    });

    test('text tool: down=append / up=page なら UP 位置で createText', () => {
      const store = createWorkspaceGestureStore();
      const pageAtUp = {
        kind: 'page' as const,
        pageId: 'p1',
        localX: 400,
        localY: 500,
        readingIndex: 0,
        insertIndex: 0,
      };
      finger(store, 'down', { tool: 'text', hit: { kind: 'append' }, now: 100 });
      const up = finger(store, 'up', {
        tool: 'text',
        hit: pageAtUp,
        now: 150,
        mapPageDomLocal: () => ({ x: 420, y: 520 }),
      });
      expect(up.effects).toEqual([{ type: 'createText', pageId: 'p1', x: 420, y: 520 }]);
    });

    test('text tool: DOM 座標が取れなくても幾何座標で createText する', () => {
      const store = createWorkspaceGestureStore();
      const pageAtUp = {
        kind: 'page' as const,
        pageId: 'p1',
        localX: 0,
        localY: 500,
        readingIndex: 0,
        insertIndex: 0,
      };
      finger(store, 'down', { tool: 'text', hit: pageAtUp, now: 100 });
      const up = finger(store, 'up', {
        tool: 'text',
        hit: pageAtUp,
        now: 150,
        mapPageDomLocal: () => null,
      });
      expect(up.effects).toEqual([{ type: 'createText', pageId: 'p1', x: 0, y: 500 }]);
    });

    test('番号帯でも移動 ≥12px ならパン（insert しない）', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', {
        hit: { kind: 'pageNumber', pageId: 'p1', readingIndex: 0 },
        x: 0,
        y: 0,
        now: 100,
        selectedPageId: 'p1',
      });
      const move = finger(store, 'move', { x: 20, y: 0, now: 120 });
      expect(move.effects[0]).toMatchObject({ type: 'panBy', dx: 20, dy: 0 });
      const up = finger(store, 'up', { x: 20, y: 0, now: 130 });
      expect(up.effects.some((e) => e.type === 'insertAfterSelected')).toBe(false);
    });
  });

  test('指がテキスト上でもパンする', () => {
    const store = createWorkspaceGestureStore();
    finger(store, 'down', { hit: pageHit, x: 0, y: 0, now: 1 });
    const move = finger(store, 'move', { hit: pageText, x: 40, y: 0, now: 2 });
    expect(getWorkspaceSession(store, 1)?.mode).toBe('pan');
    expect(move.effects[0]).toMatchObject({ type: 'panBy', dx: 40, dy: 0 });
    const again = finger(store, 'move', { hit: pageText, x: 50, y: 4, now: 3 });
    expect(again.effects.some((e) => e.type === 'moveText')).toBe(false);
    expect(again.effects[0]).toMatchObject({ type: 'panBy', dx: 10, dy: 4 });
  });

  test('指 down on pageText では selectText を出さない', () => {
    const store = createWorkspaceGestureStore();
    const down = finger(store, 'down', { hit: pageText, x: 0, y: 0, now: 1 });
    expect(down.effects.some((e) => e.type === 'selectText')).toBe(false);
    expect(getWorkspaceSession(store, 1)?.mode).toBe('fingerPending');
  });

  describe('Pencil text tap (§3.4)', () => {
    test('down では selectText を出さず、tap-up（移動 < 8px）でのみ selectText', () => {
      const store = createWorkspaceGestureStore();
      const down = pencilText(store, 'down', { x: 10, y: 10, now: 100 });
      expect(down.effects.some((e) => e.type === 'selectText')).toBe(false);
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingTextMove');

      const move = pencilText(store, 'move', { x: 14, y: 12, now: 120 });
      expect(move.effects.some((e) => e.type === 'selectText')).toBe(false);

      const up = pencilText(store, 'up', { x: 15, y: 13, now: 150 });
      expect(up.effects).toEqual([{ type: 'selectText', textId: 'tx' }]);
    });

    test('move を挟まず up で 8px 以上ずれても selectText する', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', { x: 10, y: 10, now: 100 });
      const up = pencilText(store, 'up', { x: 20, y: 18, now: 150 });
      expect(up.effects).toEqual([{ type: 'selectText', textId: 'tx' }]);
    });

    test('page 上の down では createText せず、up が pageText でも down 位置で createText', () => {
      const store = createWorkspaceGestureStore();
      const down = pencilText(store, 'down', { hit: pageHit, x: 10, y: 10, now: 100 });
      expect(down.effects.some((e) => e.type === 'createText')).toBe(false);
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingTextCreate');
      const up = pencilText(store, 'up', { x: 12, y: 11, now: 150 });
      expect(up.effects).toEqual([{ type: 'createText', pageId: 'p1', x: 10, y: 10 }]);
    });

    test('text tool: 指タップでも pageText を selectText する', () => {
      const store = createWorkspaceGestureStore();
      const down = finger(store, 'down', {
        tool: 'text',
        hit: pageText,
        x: 10,
        y: 10,
        now: 100,
      });
      expect(down.effects.some((e) => e.type === 'selectText')).toBe(false);
      expect(getWorkspaceSession(store, 1)?.mode).toBe('pendingTextMove');
      const up = finger(store, 'up', {
        tool: 'text',
        hit: pageText,
        x: 12,
        y: 11,
        now: 150,
      });
      expect(up.effects).toEqual([{ type: 'selectText', textId: 'tx' }]);
    });

    test('複数選択中に一つのテキストをタップするとそのテキストだけ selectText する', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', {
        x: 10,
        y: 10,
        worldX: 110,
        worldY: 90,
        selectedTextIds: ['tx', 'ty'],
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingSelectionMove');
      const up = pencilText(store, 'up', {
        x: 12,
        y: 11,
        worldX: 112,
        worldY: 91,
        selectedTextIds: ['tx', 'ty'],
      });
      expect(up.effects).toEqual([{ type: 'selectText', textId: 'tx' }]);
    });

    test('複数選択中に未選択テキストをタップするとそのテキストだけ selectText する', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', {
        x: 10,
        y: 10,
        worldX: 110,
        worldY: 90,
        selectedTextIds: ['ty', 'tz'],
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingTextMove');
      const up = pencilText(store, 'up', {
        x: 12,
        y: 11,
        worldX: 112,
        worldY: 91,
        selectedTextIds: ['ty', 'tz'],
      });
      expect(up.effects).toEqual([{ type: 'selectText', textId: 'tx' }]);
    });

    test('複数選択中のテキストをドラッグすると選択中のテキスト全部を動かす', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', {
        x: 10,
        y: 10,
        worldX: 110,
        worldY: 90,
        selectedTextIds: ['tx', 'ty'],
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingSelectionMove');
      const drag = pencilText(store, 'move', {
        x: 30,
        y: 10,
        worldX: 130,
        worldY: 90,
        selectedTextIds: ['tx', 'ty'],
      });
      expect(drag.effects).toEqual([
        { type: 'beginSelectionMove', clipIds: [], textIds: ['tx', 'ty'] },
        { type: 'selectionMoveLive', dx: 20, dy: 0 },
      ]);
      const up = pencilText(store, 'up', {
        x: 30,
        y: 10,
        worldX: 130,
        worldY: 90,
        selectedTextIds: ['tx', 'ty'],
      });
      expect(up.effects).toEqual([
        { type: 'selectionMoveLive', dx: 20, dy: 0 },
        { type: 'commitSelectionMove' },
      ]);
    });

    test('page 上の tap は 8px 以上ずれても createText する', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', { hit: pageHit, x: 10, y: 10, now: 100 });
      const up = pencilText(store, 'up', { hit: pageHit, x: 30, y: 18, now: 150 });
      expect(up.effects).toEqual([{ type: 'createText', pageId: 'p1', x: 10, y: 10 }]);
    });

    test('page 上で 8px 以上ドラッグするとテキスト専用の矩形選択になる', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', {
        hit: pageHit,
        x: 10,
        y: 10,
        worldX: 10,
        worldY: 10,
        now: 100,
      });
      const move = pencilText(store, 'move', {
        hit: pageHit,
        x: 30,
        y: 40,
        worldX: 30,
        worldY: 40,
        now: 120,
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('marquee');
      expect(move.effects[0]).toMatchObject({
        type: 'marqueePreview',
        pageId: null,
        rect: { x: 10, y: 10, width: 20, height: 30 },
      });
      const up = pencilText(store, 'up', {
        hit: pageHit,
        x: 30,
        y: 40,
        worldX: 30,
        worldY: 40,
        now: 150,
      });
      expect(up.effects).toEqual([
        { type: 'completeMarquee', pageId: null, rect: { x: 10, y: 10, width: 20, height: 30 } },
      ]);
    });

    test('テキスト矩形選択が小さすぎるとテキスト選択だけクリアする', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', {
        hit: pageHit,
        x: 10,
        y: 10,
        worldX: 10,
        worldY: 10,
        now: 100,
      });
      pencilText(store, 'move', {
        hit: pageHit,
        x: 19,
        y: 11,
        worldX: 12,
        worldY: 11,
        now: 120,
      });
      const up = pencilText(store, 'up', {
        hit: pageHit,
        x: 19,
        y: 11,
        worldX: 12,
        worldY: 11,
        now: 150,
      });
      expect(up.effects).toEqual([
        { type: 'completeMarquee', pageId: null, rect: { x: 10, y: 10, width: 2, height: 1 } },
        { type: 'selectTexts', textIds: [] },
      ]);
    });

    test('ページ外の empty をタップすると台紙に createText する', () => {
      const store = createWorkspaceGestureStore();
      const empty = { kind: 'empty' as const };
      const down = pencilText(store, 'down', {
        hit: empty,
        x: 80,
        y: 90,
        worldX: 400,
        worldY: 500,
        now: 100,
      });
      expect(down.effects.some((e) => e.type === 'createText')).toBe(false);
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingTextCreate');
      const up = pencilText(store, 'up', { hit: empty, x: 82, y: 91, now: 150 });
      expect(up.effects).toEqual([{ type: 'createText', pasteboard: true, x: 400, y: 500 }]);
    });

    test('テキストツールでも + をタップすると appendPage する', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', { hit: { kind: 'append' }, x: 10, y: 10, now: 100 });
      const up = pencilText(store, 'up', { hit: { kind: 'append' }, x: 11, y: 11, now: 150 });
      expect(up.effects).toEqual([{ type: 'appendPage' }]);
    });

    test('移動 ≥ 8px なら textTransformLive（tap ではない）', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', { x: 10, y: 10, now: 100 });
      const move = pencilText(store, 'move', {
        x: 20,
        y: 10,
        now: 120,
        dropHit: pageHit,
        mapWorldToPage: (_pageId, x, y) => ({ x, y }),
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('moveText');
      expect(move.effects).toContainEqual({ type: 'selectText', textId: 'tx' });
      expect(move.effects).toContainEqual({
        type: 'textTransformLive',
        textId: 'tx',
        x: 18,
        y: 7,
        pageId: 'p1',
        pasteboard: undefined,
      });

      const up = pencilText(store, 'up', {
        x: 25,
        y: 12,
        now: 150,
        hit: { ...pageText, localX: 12, localY: 9 },
        dropHit: pageHit,
        mapWorldToPage: (_pageId, x, y) => ({ x, y }),
      });
      expect(up.effects).toContainEqual({
        type: 'commitTextTransform',
        textId: 'tx',
        x: 23,
        y: 9,
        pageId: 'p1',
        pasteboard: undefined,
      });
    });

    test('ラスタ grabOffset のままだと原点がページ左上付近になり、ワールド換算では箱原点を維持する', () => {
      const { frames } = buildStripFrames(['p1']);
      const frame = frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === 'p1')!;
      const rasterWidth = 1200;
      const rasterHeight = 1700;
      const boxX = 200;
      const boxY = 300;
      const localX = 500;
      const localY = 600;
      const worldX = frame.x + (localX / rasterWidth) * frame.width;
      const worldY = frame.y + (localY / rasterHeight) * frame.height;
      const mapWorldToPage = (_pageId: string, x: number, y: number) =>
        pageLocalFromWorld(frame, x, y, rasterWidth, rasterHeight);
      const dropHit = {
        kind: 'page' as const,
        pageId: 'p1',
        localX,
        localY,
        readingIndex: 0,
        insertIndex: 0,
      };

      const rasterHit = {
        ...pageText,
        localX,
        localY,
        grabOffsetX: localX - boxX,
        grabOffsetY: localY - boxY,
      };
      const rasterStore = createWorkspaceGestureStore();
      pencilText(rasterStore, 'down', { x: 0, y: 0, worldX, worldY, hit: rasterHit, now: 100 });
      const rasterMove = pencilText(rasterStore, 'move', {
        x: 20,
        y: 0,
        worldX,
        worldY,
        hit: rasterHit,
        dropHit,
        mapWorldToPage,
        now: 120,
      });
      const rasterLive = rasterMove.effects.find((e) => e.type === 'textTransformLive');
      expect(rasterLive).toMatchObject({ type: 'textTransformLive', textId: 'tx', pageId: 'p1' });
      if (rasterLive?.type === 'textTransformLive') {
        expect(rasterLive.x).toBeLessThan(1);
        expect(rasterLive.y).toBeLessThan(1);
      }

      const worldGrab = rasterGrabOffsetToWorld(
        localX - boxX,
        localY - boxY,
        rasterWidth,
        rasterHeight,
        frame.width,
        frame.height,
      );
      const worldHit = { ...pageText, localX, localY, ...worldGrab };
      const worldStore = createWorkspaceGestureStore();
      pencilText(worldStore, 'down', { x: 0, y: 0, worldX, worldY, hit: worldHit, now: 100 });
      const worldMove = pencilText(worldStore, 'move', {
        x: 20,
        y: 0,
        worldX,
        worldY,
        hit: worldHit,
        dropHit,
        mapWorldToPage,
        now: 120,
      });
      const worldLive = worldMove.effects.find((e) => e.type === 'textTransformLive');
      expect(worldLive).toMatchObject({ type: 'textTransformLive', textId: 'tx', pageId: 'p1' });
      if (worldLive?.type === 'textTransformLive') {
        expect(worldLive.x).toBeCloseTo(boxX);
        expect(worldLive.y).toBeCloseTo(boxY);
      }
    });
  });

  test('eraser targets page raster, not clip (selectedClipId ignored)', () => {
    const store = createWorkspaceGestureStore();
    const down = pencil(store, 'down', {
      tool: 'eraser',
      selectedClipId: 'c1',
      hit: pageHit,
    });
    expect(getWorkspaceSession(store, 10)?.mode).toBe('eraseDirect');
    expect(down.effects[0]).toMatchObject({ type: 'beginEraseDirect', pageId: 'p1' });

    const move = pencil(store, 'move', {
      tool: 'eraser',
      x: 20,
      y: 25,
      hit: { ...pageHit, localX: 20, localY: 25 },
    });
    expect(move.effects[0]).toMatchObject({
      type: 'eraseDirectMove',
      pageId: 'p1',
      x: 20,
      y: 25,
    });

    const up = pencil(store, 'up', { tool: 'eraser', hit: pageHit });
    expect(up.effects[0]).toMatchObject({ type: 'commitEraseDirect', pageId: 'p1' });
  });

  test('eraser on pageText prefers page body', () => {
    const store = createWorkspaceGestureStore();
    const down = pencil(store, 'down', {
      tool: 'eraser',
      hit: pageText,
    });
    expect(getWorkspaceSession(store, 10)?.mode).toBe('eraseDirect');
    expect(down.effects[0]).toMatchObject({ type: 'beginEraseDirect', pageId: 'p1' });
  });

  test('pencil penOverlay 中に finger pan が並立する', () => {
    const store = createWorkspaceGestureStore();

    pencil(store, 'down');
    finger(store, 'down', { pointerId: 2, x: 0, y: 0, now: 1 });
    const fingerMove = finger(store, 'move', { pointerId: 2, x: 40, y: 0, now: 2 });
    expect(getWorkspaceSession(store, 2)?.mode).toBe('pan');
    expect(fingerMove.effects[0]).toMatchObject({ type: 'panBy', dx: 40, dy: 0 });

    const penMove = pencil(store, 'move', { x: 12, y: 14, now: 2 });
    expect(getWorkspaceSession(store, 10)?.mode).toBe('penOverlay');
    expect(penMove.effects[0]).toMatchObject({
      type: 'penOverlayMove',
      points: [{ x: pageHit.localX, y: pageHit.localY, pressure: 0.6 }],
    });
  });

  test('pencil penOverlay と 2本指 pinch 中、3本目の touch は無視', () => {
    const store = createWorkspaceGestureStore();

    const penDown = pencil(store, 'down');
    expect(getWorkspaceSession(store, 10)?.mode).toBe('penOverlay');
    expect(penDown.effects[0]?.type).toBe('beginPenOverlay');

    finger(store, 'down', { pointerId: 2, x: 10, y: 10, now: 1 });
    finger(store, 'down', { pointerId: 3, x: 50, y: 10, now: 1, isPrimary: false });
    expect(getWorkspaceSession(store, 2)?.mode).toBe('pinch');
    expect(getWorkspaceSession(store, 3)?.mode).toBe('pinch');

    const fingerMove = finger(store, 'move', { pointerId: 2, x: 30, y: 10, now: 2 });
    expect(fingerMove.effects[0]?.type).toBe('pinchBy');

    const penMove = pencil(store, 'move', { x: 8, y: 9, now: 2 });
    expect(getWorkspaceSession(store, 10)?.mode).toBe('penOverlay');
    expect(penMove.effects[0]?.type).toBe('penOverlayMove');

    const palm = stepWorkspacePointer(store, {
      pointerId: 99,
      kind: 'finger',
      phase: 'down',
      tool: 'pen',
      x: 0,
      y: 0,
      worldX: 0,
      worldY: 0,
      pressure: 1,
      hit: pageHit,
      now: 3,
      isPrimary: false,
      selectedPageId: null,
      selectedClipId: null,
      ...noopClip,
    });
    expect(palm.ignored).toBe(true);
    expect(getWorkspaceSession(store, 99)).toBeUndefined();
    expect(countActiveTouches(store, 'finger')).toBe(2);
    expect(countActiveTouches(store, 'pencil')).toBe(1);
  });

  test('描画中に隣ページへ出ても反対端の座標を使わない', () => {
    const store = createWorkspaceGestureStore();
    pencil(store, 'down', { hit: { ...pageHit, localX: 1190, localY: 40 } });
    const jumped = pencil(store, 'move', {
      hit: { ...pageHit, pageId: 'p2', localX: 8, localY: 42, readingIndex: 1 },
    });
    expect(jumped.effects[0]).toMatchObject({
      type: 'penOverlayMove',
      pageId: 'p1',
      points: [{ x: 1190, y: 40, pressure: 0.6 }],
    });

    const mapped = pencil(store, 'move', {
      hit: { ...pageHit, pageId: 'p2', localX: 8, localY: 80, readingIndex: 1 },
      mapInkToPage: (pageId) => (pageId === 'p1' ? { x: 1200, y: 80 } : null),
    });
    expect(mapped.effects[0]).toMatchObject({
      type: 'penOverlayMove',
      pageId: 'p1',
      points: [{ x: 1200, y: 80, pressure: 0.6 }],
    });
  });

  test('pinch の一方が離れたあとの move で b.x を読まない', () => {
    const store = createWorkspaceGestureStore();
    finger(store, 'down', { pointerId: 2, x: 10, y: 10, now: 1 });
    finger(store, 'down', { pointerId: 3, x: 50, y: 10, now: 1, isPrimary: false });
    expect(getWorkspaceSession(store, 2)?.mode).toBe('pinch');
    expect(getWorkspaceSession(store, 3)?.mode).toBe('pinch');

    finger(store, 'up', { pointerId: 3, x: 50, y: 10, now: 2, isPrimary: false });
    expect(getWorkspaceSession(store, 2)?.mode).toBe('pan');
    expect(getWorkspaceSession(store, 3)).toBeUndefined();

    const move = finger(store, 'move', { pointerId: 2, x: 18, y: 12, now: 3 });
    expect(move.effects[0]?.type).toBe('panBy');
  });

  test('Pencil 長押しでも grabPage しない', () => {
    const store = createWorkspaceGestureStore();
    const move = pencil(store, 'move', {
      hit: pageHit,
      now: 5000,
    });
    expect(move.effects.some((e) => e.type === 'grabPage')).toBe(false);
  });

  describe('長押し grab → reorder', () => {
    test('420ms 静止後にドラッグすると grabPage、離すと並べ替え終了', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { x: 0, y: 0, now: 0 });
      const held = finger(store, 'move', { x: 2, y: 0, now: LONG_PRESS_MS + 1 });
      expect(getWorkspaceSession(store, 1)?.mode).toBe('fingerPending');
      expect(held.effects.some((e) => e.type === 'grabPage')).toBe(false);

      const grab = finger(store, 'move', { x: 20, y: 0, now: LONG_PRESS_MS + 20 });
      expect(getWorkspaceSession(store, 1)?.mode).toBe('grabPage');
      expect(grab.effects).toContainEqual({ type: 'grabPage', pageId: 'p1', fromIndex: 0 });

      const targetHit = {
        kind: 'page' as const,
        pageId: 'p3',
        localX: 10,
        localY: 10,
        readingIndex: 2,
        insertIndex: 2,
      };
      const drag = finger(store, 'move', { x: 80, y: 0, now: LONG_PRESS_MS + 50, hit: targetHit });
      expect(drag.effects).toEqual([{ type: 'reorderWorkspace', pageId: 'p1', toIndex: 2 }]);

      const sameSlot = finger(store, 'move', { x: 90, y: 0, now: LONG_PRESS_MS + 60, hit: targetHit });
      expect(sameSlot.effects).toEqual([]);

      const up = finger(store, 'up', { x: 90, y: 0, now: LONG_PRESS_MS + 100, hit: targetHit });
      expect(up.effects).toEqual([{ type: 'endGrabPage' }]);
      expect(getWorkspaceSession(store, 1)).toBeUndefined();
    });

    test('420ms 静止後に離しても showPageDelete しない', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { x: 0, y: 0, now: 0 });
      finger(store, 'move', { x: 2, y: 0, now: LONG_PRESS_MS + 1 });
      const up = finger(store, 'up', { x: 2, y: 0, now: LONG_PRESS_MS + 10 });
      expect(up.effects.some((e) => e.type === 'showPageDelete')).toBe(false);
    });

    test('reorderTargetIndex: append は末尾 (-1)', () => {
      expect(reorderTargetIndex({ kind: 'append' })).toBe(-1);
      expect(reorderTargetIndex({ kind: 'slot', insertIndex: 1 })).toBe(1);
    });

    test('reorderTargetIndex: pageText は page 本体と同じ readingIndex', () => {
      expect(reorderTargetIndex(pageText)).toBe(0);
      expect(
        reorderTargetIndex({
          kind: 'pageText',
          textId: 'tx2',
          pageId: 'p3',
          localX: 1,
          localY: 2,
          grabOffsetX: 0,
          grabOffsetY: 0,
          readingIndex: 2,
          insertIndex: 2,
        }),
      ).toBe(2);
    });

    test('grabPage 中に pageText 上でも reorderWorkspace が更新される', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { x: 0, y: 0, now: 0 });
      finger(store, 'move', { x: 2, y: 0, now: LONG_PRESS_MS + 1 });
      finger(store, 'move', { x: 20, y: 0, now: LONG_PRESS_MS + 20 });

      const textOnP3 = {
        kind: 'pageText' as const,
        textId: 'tx3',
        pageId: 'p3',
        localX: 10,
        localY: 10,
        grabOffsetX: 0,
        grabOffsetY: 0,
        readingIndex: 2,
        insertIndex: 2,
      };
      const drag = finger(store, 'move', { x: 80, y: 0, now: LONG_PRESS_MS + 50, hit: textOnP3 });
      expect(drag.effects).toEqual([{ type: 'reorderWorkspace', pageId: 'p1', toIndex: 2 }]);
    });

    test('reduceWorkspaceEffects が reorderWorkspace を dispatch 用に解決', () => {
      const doc = {
        workspaceOrder: ['p1', 'p2', 'p3'],
        workspaceZoom: 1,
        workspacePanX: 0,
        workspacePanY: 0,
      } as Parameters<typeof reduceWorkspaceEffects>[0];
      const batch = reduceWorkspaceEffects(
        doc,
        [{ type: 'reorderWorkspace', pageId: 'p1', toIndex: 2 }],
        new Map(),
        null,
      );
      expect(batch.actions).toEqual([{ type: 'reorderWorkspace', fromIndex: 0, toIndex: 2 }]);
    });

    test('reduceWorkspaceEffects が endGrabPage で grabbedPageId を解放する', () => {
      const doc = {
        workspaceOrder: ['p1', 'p2', 'p3'],
        workspaceZoom: 1,
        workspacePanX: 0,
        workspacePanY: 0,
      } as Parameters<typeof reduceWorkspaceEffects>[0];
      const batch = reduceWorkspaceEffects(doc, [{ type: 'endGrabPage' }], new Map(), null);
      expect(batch.grabbedPageId).toBeNull();
    });
  });

  describe('select / marquee', () => {
    test('select / eraser でも + の tap は appendPage する', () => {
      for (const tool of ['select', 'eraser', 'lasso'] as const) {
        const store = createWorkspaceGestureStore();
        pencil(store, 'down', { tool, hit: { kind: 'append' }, x: 10, y: 10, now: 100 });
        const up = pencil(store, 'up', { tool, hit: { kind: 'append' }, x: 11, y: 11, now: 150 });
        expect(up.effects).toEqual([{ type: 'appendPage' }]);
      }
    });

    test('pencil select on page starts marquee; finger still pans', () => {
      const store = createWorkspaceGestureStore();
      const down = pencil(store, 'down', { tool: 'select', x: 10, y: 10 });
      expect(down.effects[0]?.type).toBe('marqueePreview');
      expect(getWorkspaceSession(store, 10)?.mode).toBe('marquee');

      finger(store, 'down', { pointerId: 2, x: 0, y: 0, now: 1 });
      const pan = finger(store, 'move', { pointerId: 2, x: 30, y: 0, now: 2 });
      expect(pan.effects[0]).toMatchObject({ type: 'panBy', dx: 30, dy: 0 });
    });

    test('select on pageText prefers page (marquee, not text)', () => {
      const store = createWorkspaceGestureStore();
      const down = pencil(store, 'down', {
        tool: 'select',
        hit: pageText,
        x: 10,
        y: 10,
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('marquee');
      expect(down.effects.some((e) => e.type === 'selectText')).toBe(false);
    });

    test('select on pageText grabs text when the text filter is on', () => {
      const store = createWorkspaceGestureStore();
      const down = pencil(store, 'down', {
        tool: 'select',
        hit: pageText,
        x: 10,
        y: 10,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingTextMove');
      expect(down.effects.some((e) => e.type === 'selectText')).toBe(false);
      const up = pencil(store, 'up', {
        tool: 'select',
        hit: pageText,
        x: 11,
        y: 11,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(up.effects).toEqual([{ type: 'selectText', textId: 'tx' }]);
    });

    test('marquee up emits completeMarquee in world space', () => {
      const store = createWorkspaceGestureStore();
      pencil(store, 'down', { tool: 'select', x: 10, y: 10, worldX: 10, worldY: 10 });
      pencil(store, 'move', {
        tool: 'select',
        x: 30,
        y: 40,
        worldX: 30,
        worldY: 40,
        hit: { ...pageHit, localX: 30, localY: 40 },
      });
      const up = pencil(store, 'up', {
        tool: 'select',
        x: 30,
        y: 40,
        worldX: 30,
        worldY: 40,
        hit: { ...pageHit, localX: 30, localY: 40 },
      });
      expect(up.effects[0]).toMatchObject({
        type: 'completeMarquee',
        pageId: null,
        rect: { x: 10, y: 10, width: 20, height: 30 },
      });
    });

    test('marquee can start off-page and finish on a page', () => {
      const store = createWorkspaceGestureStore();
      const empty = { kind: 'empty' as const };
      pencil(store, 'down', { tool: 'select', hit: empty, worldX: -20, worldY: -10 });
      pencil(store, 'move', { tool: 'select', hit: pageHit, worldX: 40, worldY: 50 });
      const up = pencil(store, 'up', { tool: 'select', hit: pageHit, worldX: 40, worldY: 50 });
      expect(up.effects[0]).toMatchObject({
        type: 'completeMarquee',
        pageId: null,
        rect: { x: -20, y: -10, width: 60, height: 60 },
      });
    });

    test('marquee below 4 world pixels clears selection', () => {
      const store = createWorkspaceGestureStore();
      pencil(store, 'down', { tool: 'select', hit: pageHit, worldX: 10, worldY: 10 });
      const tiny = { ...pageHit, localX: 13, localY: 12 };
      pencil(store, 'move', { tool: 'select', hit: tiny, worldX: 12, worldY: 12 });
      const up = pencil(store, 'up', { tool: 'select', hit: tiny, worldX: 12, worldY: 12 });
      expect(up.effects).toEqual([
        { type: 'completeMarquee', pageId: null, rect: { x: 10, y: 10, width: 2, height: 2 } },
        { type: 'selectClips', clipIds: [] },
        { type: 'selectTexts', textIds: [] },
      ]);
    });

    test('pencil select on pasteboard starts a world-space marquee', () => {
      const store = createWorkspaceGestureStore();
      const empty = { kind: 'empty' as const };
      const down = pencil(store, 'down', { tool: 'select', hit: empty, worldX: 40, worldY: 50 });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('marquee');
      expect(down.effects[0]).toMatchObject({
        type: 'marqueePreview',
        pageId: null,
        rect: { x: 40, y: 50, width: 0, height: 0 },
      });
      pencil(store, 'move', { tool: 'select', hit: empty, worldX: 80, worldY: 90 });
      const up = pencil(store, 'up', { tool: 'select', hit: empty, worldX: 80, worldY: 90 });
      expect(up.effects[0]).toMatchObject({
        type: 'completeMarquee',
        pageId: null,
        rect: { x: 40, y: 50, width: 40, height: 40 },
      });
    });

    test('tiny pasteboard marquee clears clip selection', () => {
      const store = createWorkspaceGestureStore();
      const empty = { kind: 'empty' as const };
      pencil(store, 'down', { tool: 'select', hit: empty, worldX: 10, worldY: 10, selectedClipId: 'c1' });
      const up = pencil(store, 'up', { tool: 'select', hit: empty, worldX: 11, worldY: 11 });
      expect(up.effects).toEqual([
        { type: 'completeMarquee', pageId: null, rect: { x: 10, y: 10, width: 1, height: 1 } },
        { type: 'selectClips', clipIds: [] },
        { type: 'selectTexts', textIds: [] },
      ]);
    });

    test('pencil tap on page number selects page (mouse/pen)', () => {
      const store = createWorkspaceGestureStore();
      pencil(store, 'down', {
        tool: 'select',
        hit: { kind: 'pageNumber', pageId: 'p2', readingIndex: 1 },
        x: 100,
        y: 200,
      });
      const up = pencil(store, 'up', {
        tool: 'select',
        hit: { kind: 'pageNumber', pageId: 'p2', readingIndex: 1 },
        x: 100,
        y: 200,
      });
      expect(up.effects).toEqual([
        { type: 'selectPage', pageId: 'p2' },
        { type: 'showPageDelete', pageId: 'p2' },
      ]);
    });

    test('moveClip uses world coordinates under zoom', () => {
      const store = createWorkspaceGestureStore();
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const clipHit = { kind: 'clip' as const, clipId: 'c1', handle: 'body' as const };
      pencil(store, 'down', {
        tool: 'select',
        hit: clipHit,
        x: 300,
        y: 240,
        worldX: 150,
        worldY: 120,
        getClipMeta: () => clip,
        getClipRasterSize: () => ({ width: 40, height: 40 }),
      });
      const move = pencil(store, 'move', {
        tool: 'select',
        hit: clipHit,
        x: 320,
        y: 260,
        worldX: 160,
        worldY: 130,
        getClipMeta: () => clip,
        getClipRasterSize: () => ({ width: 40, height: 40 }),
      });
      expect(move.effects).toContainEqual({
        type: 'clipTransformLive',
        clipId: 'c1',
        x: 110,
        y: 90,
      });

      const up = pencil(store, 'up', {
        tool: 'select',
        hit: clipHit,
        worldX: 160,
        worldY: 130,
        getClipMeta: () => clip,
        getClipRasterSize: () => ({ width: 40, height: 40 }),
      });
      expect(up.effects).toEqual([
        { type: 'clipTransformLive', clipId: 'c1', x: 110, y: 90 },
        { type: 'commitClipTransform', clipId: 'c1' },
      ]);
    });

    test('moveClip release on a page commits pose instead of baking', () => {
      const store = createWorkspaceGestureStore();
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const clipHit = { kind: 'clip' as const, clipId: 'c1', handle: 'body' as const };
      pencil(store, 'down', {
        tool: 'select',
        hit: clipHit,
        worldX: 110,
        worldY: 90,
        getClipMeta: () => clip,
      });
      const up = pencil(store, 'up', {
        tool: 'select',
        hit: clipHit,
        dropHit: pageHit,
        worldX: 210,
        worldY: 190,
        getClipMeta: () => clip,
        mapWorldToPage: (_pageId, x, y) => ({ x, y }),
      });
      expect(up.effects).toEqual([
        { type: 'clipTransformLive', clipId: 'c1', x: 200, y: 180 },
        { type: 'commitClipTransform', clipId: 'c1' },
      ]);
    });

    test('moveClip release does not bake when clip center is outside the page', () => {
      const store = createWorkspaceGestureStore();
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const clipHit = { kind: 'clip' as const, clipId: 'c1', handle: 'body' as const };
      pencil(store, 'down', {
        tool: 'select',
        hit: clipHit,
        worldX: 110,
        worldY: 90,
        getClipMeta: () => clip,
      });
      const up = pencil(store, 'up', {
        tool: 'select',
        hit: clipHit,
        dropHit: pageHit,
        worldX: 210,
        worldY: 190,
        getClipMeta: () => clip,
        pageInkAtWorld: () => null,
        mapWorldToPage: () => ({ x: -40, y: 10 }),
      });
      expect(up.effects).toEqual([
        { type: 'clipTransformLive', clipId: 'c1', x: 200, y: 180 },
        { type: 'commitClipTransform', clipId: 'c1' },
      ]);
    });

    test('moveClip release does not bake when clip origin is off the page even if center hits', () => {
      const store = createWorkspaceGestureStore();
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const clipHit = { kind: 'clip' as const, clipId: 'c1', handle: 'body' as const };
      pencil(store, 'down', {
        tool: 'select',
        hit: clipHit,
        worldX: 110,
        worldY: 90,
        getClipMeta: () => clip,
      });
      const up = pencil(store, 'up', {
        tool: 'select',
        hit: clipHit,
        dropHit: pageHit,
        worldX: 210,
        worldY: 190,
        getClipMeta: () => clip,
        pageInkAtWorld: (worldX, worldY) => {
          if (worldX > 201) {
            return { pageId: 'p1', localX: worldX, localY: worldY };
          }
          return null;
        },
      });
      expect(up.effects).toEqual([
        { type: 'clipTransformLive', clipId: 'c1', x: 200, y: 180 },
        { type: 'commitClipTransform', clipId: 'c1' },
      ]);
    });

    test('dragging an already-selected clip moves the whole selection', () => {
      const store = createWorkspaceGestureStore();
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const clipHit = { kind: 'clip' as const, clipId: 'c1', handle: 'body' as const };
      pencil(store, 'down', {
        tool: 'select',
        hit: clipHit,
        x: 10,
        y: 10,
        worldX: 110,
        worldY: 90,
        selectedClipIds: ['c1', 'c2'],
        selectedTextIds: ['tx'],
        getClipMeta: () => clip,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingSelectionMove');
      const drag = pencil(store, 'move', {
        tool: 'select',
        hit: clipHit,
        x: 30,
        y: 10,
        worldX: 130,
        worldY: 90,
        getClipMeta: () => clip,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(drag.effects).toEqual([
        { type: 'beginSelectionMove', clipIds: ['c1', 'c2'], textIds: ['tx'] },
        { type: 'selectionMoveLive', dx: 20, dy: 0 },
      ]);
      const up = pencil(store, 'up', {
        tool: 'select',
        hit: clipHit,
        x: 30,
        y: 10,
        worldX: 130,
        worldY: 90,
        getClipMeta: () => clip,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(up.effects).toEqual([
        { type: 'selectionMoveLive', dx: 20, dy: 0 },
        { type: 'commitSelectionMove' },
      ]);
    });

    test('複数選択をストック上で離すと cancelSelectionMove', () => {
      vi.mocked(clientOverStockPane).mockReturnValueOnce(true);
      const store = createWorkspaceGestureStore();
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const clipHit = { kind: 'clip' as const, clipId: 'c1', handle: 'body' as const };
      pencil(store, 'down', {
        tool: 'select',
        hit: clipHit,
        x: 10,
        y: 10,
        worldX: 110,
        worldY: 90,
        selectedClipIds: ['c1', 'c2'],
        selectedTextIds: ['tx'],
        getClipMeta: () => clip,
        selectTargets: { text: true, ink: true, clip: true },
      });
      pencil(store, 'move', {
        tool: 'select',
        hit: clipHit,
        x: 30,
        y: 10,
        worldX: 130,
        worldY: 90,
        getClipMeta: () => clip,
        selectTargets: { text: true, ink: true, clip: true },
      });
      const up = pencil(store, 'up', {
        tool: 'select',
        hit: clipHit,
        x: 30,
        y: 10,
        worldX: 130,
        worldY: 90,
        getClipMeta: () => clip,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(up.effects).toEqual([{ type: 'cancelSelectionMove' }]);
    });

    test('dragging two selected texts moves the whole selection', () => {
      const store = createWorkspaceGestureStore();
      pencil(store, 'down', {
        tool: 'select',
        hit: pageText,
        x: 10,
        y: 10,
        worldX: 110,
        worldY: 90,
        selectedTextIds: ['tx', 'ty'],
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingSelectionMove');
      const drag = pencil(store, 'move', {
        tool: 'select',
        hit: pageText,
        x: 30,
        y: 10,
        worldX: 130,
        worldY: 90,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(drag.effects).toEqual([
        { type: 'beginSelectionMove', clipIds: [], textIds: ['tx', 'ty'] },
        { type: 'selectionMoveLive', dx: 20, dy: 0 },
      ]);
      const up = pencil(store, 'up', {
        tool: 'select',
        hit: pageText,
        x: 30,
        y: 10,
        worldX: 130,
        worldY: 90,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(up.effects).toEqual([
        { type: 'selectionMoveLive', dx: 20, dy: 0 },
        { type: 'commitSelectionMove' },
      ]);
    });

    test('clip transform cancel discards the live pose', () => {
      const store = createWorkspaceGestureStore();
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const clipHit = { kind: 'clip' as const, clipId: 'c1', handle: 'body' as const };
      pencil(store, 'down', { tool: 'select', hit: clipHit, getClipMeta: () => clip });
      const cancel = pencil(store, 'cancel', { tool: 'select', hit: clipHit, getClipMeta: () => clip });
      expect(cancel.effects).toEqual([{ type: 'cancelClipTransform', clipId: 'c1' }]);
    });

    test('clip corner and rotate handles produce live transforms and one commit', () => {
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const raster = { getClipMeta: () => clip, getClipRasterSize: () => ({ width: 100, height: 100 }) };

      const scaleStore = createWorkspaceGestureStore();
      const cornerHit = { kind: 'clip' as const, clipId: 'c1', handle: 'corner' as const };
      pencil(scaleStore, 'down', {
        tool: 'select',
        hit: cornerHit,
        worldX: 118,
        worldY: 98,
        ...raster,
      });
      const scaleMove = pencil(scaleStore, 'move', {
        tool: 'select',
        hit: cornerHit,
        worldX: 127,
        worldY: 107,
        ...raster,
      });
      expect(scaleMove.effects[0]).toMatchObject({ type: 'clipTransformLive', clipId: 'c1' });
      expect(scaleMove.effects[0]?.type === 'clipTransformLive' && scaleMove.effects[0].scale).toBeGreaterThan(1);
      expect(scaleMove.effects[0]?.type === 'clipTransformLive' && scaleMove.effects[0].scaleY).toBeGreaterThan(1);

      const wideStore = createWorkspaceGestureStore();
      pencil(wideStore, 'down', {
        tool: 'select',
        hit: cornerHit,
        worldX: 118,
        worldY: 98,
        ...raster,
      });
      const wideMove = pencil(wideStore, 'move', {
        tool: 'select',
        hit: cornerHit,
        worldX: 136,
        worldY: 98,
        ...raster,
      });
      expect(wideMove.effects[0]?.type === 'clipTransformLive' && wideMove.effects[0].scale).toBeGreaterThan(1);
      expect(wideMove.effects[0]?.type === 'clipTransformLive' && wideMove.effects[0].scaleY).toBeCloseTo(1);

      const rotateStore = createWorkspaceGestureStore();
      const rotateHit = { kind: 'clip' as const, clipId: 'c1', handle: 'rotate' as const };
      pencil(rotateStore, 'down', {
        tool: 'select',
        hit: rotateHit,
        worldX: 109,
        worldY: 60,
        ...raster,
      });
      const rotateUp = pencil(rotateStore, 'up', {
        tool: 'select',
        hit: rotateHit,
        worldX: 130,
        worldY: 89,
        ...raster,
      });
      expect(rotateUp.effects[0]).toMatchObject({ type: 'clipTransformLive', clipId: 'c1' });
      expect(rotateUp.effects[1]).toEqual({ type: 'commitClipTransform', clipId: 'c1' });
    });

    test('selected text SE handle resizes uniformly and commits only on up', () => {
      const store = createWorkspaceGestureStore();
      const handle = {
        kind: 'resizeHandle' as const,
        textId: 'tx',
        owner: 'pasteboard' as const,
        worldBox: { x: 0, y: 0, width: 10, height: 20 },
      };
      pencilText(store, 'down', { hit: handle, worldX: 10, worldY: 20 });
      const move = pencilText(store, 'move', { hit: handle, worldX: 30, worldY: 60 });
      expect(move.effects).toContainEqual({
        type: 'textResizeLive',
        textId: 'tx',
        box: { x: 0, y: 0, width: 30, height: 60 },
      });
      const up = pencilText(store, 'up', { hit: handle, worldX: 30, worldY: 60 });
      expect(up.effects).toContainEqual({
        type: 'commitTextResize',
        textId: 'tx',
        box: { x: 0, y: 0, width: 30, height: 60 },
      });
    });

    test('text resize cancel discards live dimensions', () => {
      const store = createWorkspaceGestureStore();
      const handle = {
        kind: 'resizeHandle' as const,
        textId: 'tx',
        owner: 'pasteboard' as const,
        worldBox: { x: 0, y: 0, width: 10, height: 20 },
      };
      pencilText(store, 'down', { hit: handle, worldX: 10, worldY: 20 });
      const cancel = pencilText(store, 'cancel', { hit: handle, worldX: 30, worldY: 60 });
      expect(cancel.effects).toEqual([{ type: 'cancelTextResize', textId: 'tx' }]);
    });
  });

  describe('lasso', () => {
    test('pencil lasso on page starts a path; finger still pans', () => {
      const store = createWorkspaceGestureStore();
      const down = pencil(store, 'down', { tool: 'lasso', worldX: 10, worldY: 10 });
      expect(down.effects[0]).toEqual({
        type: 'lassoPreview',
        points: [{ x: 10, y: 10 }],
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('lasso');

      finger(store, 'down', { pointerId: 2, x: 0, y: 0, now: 1 });
      const pan = finger(store, 'move', { pointerId: 2, x: 30, y: 0, now: 2 });
      expect(pan.effects[0]).toMatchObject({ type: 'panBy', dx: 30, dy: 0 });
    });

    test('lasso up emits completeLasso in world space', () => {
      const store = createWorkspaceGestureStore();
      pencil(store, 'down', { tool: 'lasso', worldX: 10, worldY: 10 });
      pencil(store, 'move', { tool: 'lasso', worldX: 40, worldY: 10 });
      pencil(store, 'move', { tool: 'lasso', worldX: 40, worldY: 40 });
      const up = pencil(store, 'up', { tool: 'lasso', worldX: 10, worldY: 40 });
      expect(up.effects[0]).toMatchObject({
        type: 'completeLasso',
        points: [
          { x: 10, y: 10 },
          { x: 40, y: 10 },
          { x: 40, y: 40 },
          { x: 10, y: 40 },
        ],
      });
    });

    test('lasso can start off-page', () => {
      const store = createWorkspaceGestureStore();
      const empty = { kind: 'empty' as const };
      const down = pencil(store, 'down', { tool: 'lasso', hit: empty, worldX: -20, worldY: -10 });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('lasso');
      expect(down.effects[0]).toMatchObject({
        type: 'lassoPreview',
        points: [{ x: -20, y: -10 }],
      });
    });

    test('lasso on a clip body starts moveClip', () => {
      const store = createWorkspaceGestureStore();
      const clip = { id: 'c1', x: 100, y: 80, scale: 1, rotation: 0, rasterId: 'r1' };
      const clipHit = { kind: 'clip' as const, clipId: 'c1', handle: 'body' as const };
      const down = pencil(store, 'down', {
        tool: 'lasso',
        hit: clipHit,
        worldX: 150,
        worldY: 120,
        selectTargets: { text: true, ink: true, clip: true },
        getClipMeta: () => clip,
        getClipRasterSize: () => ({ width: 40, height: 40 }),
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('moveClip');
      expect(down.effects).toEqual([{ type: 'selectClip', clipId: 'c1' }]);
    });

    test('lasso on pageText grabs text when the text filter is on', () => {
      const store = createWorkspaceGestureStore();
      const down = pencil(store, 'down', {
        tool: 'lasso',
        hit: pageText,
        x: 10,
        y: 10,
        selectTargets: { text: true, ink: true, clip: true },
      });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('pendingTextMove');
      expect(down.effects.some((e) => e.type === 'selectText')).toBe(false);
    });

    test('tiny lasso clears selection', () => {
      const store = createWorkspaceGestureStore();
      pencil(store, 'down', { tool: 'lasso', hit: pageHit, worldX: 10, worldY: 10 });
      const up = pencil(store, 'up', { tool: 'lasso', hit: pageHit, worldX: 11, worldY: 11 });
      expect(up.effects).toEqual([
        { type: 'completeLasso', points: [{ x: 10, y: 10 }, { x: 11, y: 11 }] },
        { type: 'selectClips', clipIds: [] },
        { type: 'selectTexts', textIds: [] },
      ]);
    });
  });

  describe('PC desktop navigation', () => {
    test('right mouse button pans immediately without slop', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', {
        pointerId: 4,
        pointerType: 'mouse',
        desktopNav: 'pan',
        x: 50,
        y: 80,
        now: 1,
      });
      expect(getWorkspaceSession(store, 4)?.mode).toBe('pan');

      const move = finger(store, 'move', {
        pointerId: 4,
        pointerType: 'mouse',
        desktopNav: 'pan',
        x: 70,
        y: 90,
        now: 2,
      });
      expect(move.effects[0]).toMatchObject({ type: 'panBy', dx: 20, dy: 10 });

      const up = finger(store, 'up', {
        pointerId: 4,
        pointerType: 'mouse',
        desktopNav: 'pan',
        x: 70,
        y: 90,
        now: 3,
      });
      expect(up.effects).toEqual([]);
      expect(getWorkspaceSession(store, 4)).toBeUndefined();
    });

    test('Space+drag pans immediately without slop', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', {
        pointerId: 3,
        pointerType: 'mouse',
        desktopNav: 'pan',
        x: 100,
        y: 200,
        now: 1,
      });
      expect(getWorkspaceSession(store, 3)?.mode).toBe('pan');

      const move = finger(store, 'move', {
        pointerId: 3,
        pointerType: 'mouse',
        desktopNav: 'pan',
        x: 140,
        y: 220,
        now: 2,
      });
      expect(move.effects[0]).toMatchObject({ type: 'panBy', dx: 40, dy: 20 });
    });

    test('Ctrl+Space+drag zooms in when dragging up and out when dragging down', () => {
      const store = createWorkspaceGestureStore();
      const doc = {
        workspaceZoom: 1,
        workspacePanX: 0,
        workspacePanY: 0,
        workspaceOrder: ['p1'],
        pages: { p1: { id: 'p1', texts: [], rasterId: 'r1' } },
      } as const;
      const surfaceRect = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;

      finger(store, 'down', {
        pointerId: 4,
        pointerType: 'mouse',
        desktopNav: 'zoom',
        x: 200,
        y: 300,
        now: 1,
      });
      expect(getWorkspaceSession(store, 4)?.mode).toBe('zoomDrag');

      const zoomIn = finger(store, 'move', {
        pointerId: 4,
        pointerType: 'mouse',
        desktopNav: 'zoom',
        x: 200,
        y: 220,
        now: 2,
      });
      const zoomInBatch = reduceWorkspaceEffects(doc as never, zoomIn.effects, store.fingerPositions, surfaceRect);
      expect(zoomInBatch.view?.zoom).toBeGreaterThan(1);

      const zoomOut = finger(store, 'move', {
        pointerId: 4,
        pointerType: 'mouse',
        desktopNav: 'zoom',
        x: 200,
        y: 360,
        now: 3,
      });
      const zoomOutBatch = reduceWorkspaceEffects(
        { ...doc, workspaceZoom: zoomInBatch.view?.zoom ?? 1 } as never,
        zoomOut.effects,
        store.fingerPositions,
        surfaceRect,
      );
      expect(zoomOutBatch.view?.zoom).toBeLessThan(zoomInBatch.view?.zoom ?? 1);
    });
  });
});
