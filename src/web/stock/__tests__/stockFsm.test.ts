import { describe, expect, test } from 'vitest';
import { LONG_PRESS_MS } from '../../../domain/workspaceGestures';
import { stepStockPointer } from '../stockFsm';
import { createStockGestureStore } from '../types';

function finger(
  store: ReturnType<typeof createStockGestureStore>,
  phase: 'down' | 'move' | 'up' | 'cancel',
  overrides: Partial<Parameters<typeof stepStockPointer>[1]> = {},
) {
  const x = overrides.x ?? 0;
  const y = overrides.y ?? 0;
  return stepStockPointer(store, {
    pointerId: 1,
    kind: 'finger',
    phase,
    x,
    y,
    hit: { kind: 'thumb', pageId: 'p1' },
    now: 1,
    isPrimary: true,
    layout: 'grid',
    ...overrides,
  });
}

describe('stock FSM page delete', () => {
  test('長押しして動かさずに離すと showPageDelete', () => {
    const store = createStockGestureStore();
    finger(store, 'down', { now: 0 });
    finger(store, 'move', { x: 2, y: 0, now: LONG_PRESS_MS + 1 });
    const up = finger(store, 'up', { x: 2, y: 0, now: LONG_PRESS_MS + 10 });
    expect(up.effects).toEqual([{ type: 'showPageDelete', pageId: 'p1' }]);
  });

  test('grid では 12px 動かすとパン（ページドラッグしない）', () => {
    const store = createStockGestureStore();
    finger(store, 'down', { now: 0 });
    const pan = finger(store, 'move', { x: 20, y: 0, now: 30 });
    expect(pan.effects).toEqual([{ type: 'panBy', dx: 20, dy: 0 }]);
  });

  test('grid では長押し後に動かすと dragPage', () => {
    const store = createStockGestureStore();
    finger(store, 'down', { now: 0 });
    finger(store, 'move', { x: 2, y: 0, now: LONG_PRESS_MS + 1 });
    const drag = finger(store, 'move', { x: 20, y: 0, now: LONG_PRESS_MS + 20 });
    expect(drag.effects).toEqual([{ type: 'dragPage', pageId: 'p1' }]);
  });

  test('free では 12px で従来どおり dragPage', () => {
    const store = createStockGestureStore();
    finger(store, 'down', { now: 0, layout: 'free' });
    const drag = finger(store, 'move', { x: 20, y: 0, now: 30, layout: 'free' });
    expect(drag.effects).toEqual([{ type: 'dragPage', pageId: 'p1' }]);
  });

  test('grid でも 2本指で pinchBy する', () => {
    const store = createStockGestureStore();
    finger(store, 'down', {
      pointerId: 1,
      layout: 'grid',
      hit: { kind: 'empty' },
      now: 0,
      x: 0,
      y: 0,
    });
    finger(store, 'down', {
      pointerId: 2,
      layout: 'grid',
      hit: { kind: 'empty' },
      now: 1,
      x: 40,
      y: 0,
      isPrimary: false,
    });
    const move = finger(store, 'move', {
      pointerId: 2,
      layout: 'grid',
      hit: { kind: 'empty' },
      now: 2,
      x: 80,
      y: 0,
      isPrimary: false,
    });
    expect(move.effects[0]?.type).toBe('pinchBy');
    expect((move.effects[0] as { type: 'pinchBy'; scaleBy: number }).scaleBy).toBeGreaterThan(1);
  });
});
