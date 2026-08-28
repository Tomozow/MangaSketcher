import { describe, expect, test } from 'vitest';
import { LONG_PRESS_MS, canGrabPage } from '../../../domain/workspaceGestures';
import {
  countActiveTouches,
  getWorkspaceSession,
  reorderTargetIndex,
  stepWorkspacePointer,
} from '../workspaceFsm';
import { createWorkspaceGestureStore } from '../types';
import { reduceWorkspaceEffects } from '../workspaceEffects';

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

function pencilText(
  store: ReturnType<typeof createWorkspaceGestureStore>,
  phase: 'down' | 'move' | 'up',
  overrides: Partial<Parameters<typeof stepWorkspacePointer>[1]> = {},
) {
  return stepWorkspacePointer(store, {
    pointerId: 10,
    kind: 'pencil',
    phase,
    tool: 'text',
    x: 4,
    y: 5,
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
      expect(up.effects).toEqual([{ type: 'selectPage', pageId: 'p2' }]);
    });

    test('pending up → 選択済みなら insertAfterSelected', () => {
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
      expect(up.effects).toEqual([{ type: 'insertAfterSelected' }]);
    });

    test('pending up on + → appendPage', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { hit: { kind: 'append' }, now: 100 });
      const up = finger(store, 'up', { hit: { kind: 'append' }, now: 150 });
      expect(up.effects).toEqual([{ type: 'appendPage' }]);
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

    test('移動 ≥ 8px なら moveText（tap ではない）', () => {
      const store = createWorkspaceGestureStore();
      pencilText(store, 'down', { x: 10, y: 10, now: 100 });
      const move = pencilText(store, 'move', { x: 20, y: 10, now: 120 });
      expect(getWorkspaceSession(store, 10)?.mode).toBe('moveText');
      expect(move.effects).toContainEqual({ type: 'selectText', textId: 'tx' });
      expect(move.effects).toContainEqual({ type: 'moveText', textId: 'tx', x: 5, y: 5 });
    });
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
    expect(penMove.effects[0]?.type).toBe('penOverlayMove');
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

  test('Pencil 長押しでも grabPage しない', () => {
    const store = createWorkspaceGestureStore();
    const move = pencil(store, 'move', {
      hit: pageHit,
      now: 5000,
    });
    expect(move.effects.some((e) => e.type === 'grabPage')).toBe(false);
  });

  describe('長押し grab → reorder', () => {
    test('420ms 静止後 grabPage、ドラッグで reorderWorkspace', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { x: 0, y: 0, now: 0 });
      const grab = finger(store, 'move', { x: 2, y: 0, now: LONG_PRESS_MS + 1 });
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
      expect(up.effects).toEqual([]);
      expect(getWorkspaceSession(store, 1)).toBeUndefined();
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
          readingIndex: 2,
          insertIndex: 2,
        }),
      ).toBe(2);
    });

    test('grabPage 中に pageText 上でも reorderWorkspace が更新される', () => {
      const store = createWorkspaceGestureStore();
      finger(store, 'down', { x: 0, y: 0, now: 0 });
      finger(store, 'move', { x: 2, y: 0, now: LONG_PRESS_MS + 1 });

      const textOnP3 = {
        kind: 'pageText' as const,
        textId: 'tx3',
        pageId: 'p3',
        localX: 10,
        localY: 10,
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
  });

  describe('select / marquee', () => {
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

    test('marquee up emits completeMarquee', () => {
      const store = createWorkspaceGestureStore();
      pencil(store, 'down', { tool: 'select', x: 10, y: 10 });
      pencil(store, 'move', { tool: 'select', x: 30, y: 40, hit: { ...pageHit, localX: 30, localY: 40 } });
      const up = pencil(store, 'up', { tool: 'select', x: 30, y: 40, hit: { ...pageHit, localX: 30, localY: 40 } });
      expect(up.effects[0]).toMatchObject({
        type: 'completeMarquee',
        pageId: 'p1',
        rect: { x: 10, y: 10, width: 20, height: 30 },
      });
    });
  });
});
