import { describe, expect, test } from 'vitest';
import { pdfPageViewerKey } from '../../../domain/pdfView';
import { LONG_PRESS_MS, PAN_SLOP } from '../../../domain/workspaceGestures';
import {
  createPdfGestureStore,
  stepPdfLongPressTimer,
  stepPdfPointer,
} from '../pdfGestureFsm';

function finger(
  store: ReturnType<typeof createPdfGestureStore>,
  phase: 'down' | 'move' | 'up',
  overrides: Partial<Parameters<typeof stepPdfPointer>[1]> = {},
) {
  return stepPdfPointer(store, {
    pointerId: 1,
    kind: 'finger',
    phase,
    x: 0,
    y: 0,
    now: 0,
    panX: 0,
    panY: 0,
    ...overrides,
  });
}

describe('pdfPageViewerKey', () => {
  test('page と generation の両方で key が変わる', () => {
    expect(pdfPageViewerKey('pdfs/p1.pdf', 1, 1)).not.toBe(pdfPageViewerKey('pdfs/p1.pdf', 2, 1));
    expect(pdfPageViewerKey('pdfs/p1.pdf', 2, 1)).toContain('#page=2');
    expect(pdfPageViewerKey('pdfs/p1.pdf', 1, 2)).not.toBe(pdfPageViewerKey('pdfs/p1.pdf', 1, 1));
    expect(pdfPageViewerKey('pdfs/p1.pdf', 1, 2)).toContain('#g=2');
  });
});

describe('PDF パン vs 範囲 (§8.6 / §13.1)', () => {
  test('12px 未満 420ms → range', () => {
    const store = createPdfGestureStore();
    finger(store, 'down', { now: 0 });
    const effects = finger(store, 'move', { now: LONG_PRESS_MS + 1, x: 2, y: 1 });
    expect(effects.some((effect) => effect.type === 'pdfRangePreview')).toBe(true);
    expect(store.session?.mode).toBe('range');
  });

  test('12px 未満 100ms で up → キャンセル', () => {
    const store = createPdfGestureStore();
    finger(store, 'down', { now: 0 });
    const effects = finger(store, 'up', { now: 100, x: 1, y: 0 });
    expect(effects).toEqual([{ type: 'pdfRangeCancel' }]);
  });

  test('12px 超 100ms → pan', () => {
    const store = createPdfGestureStore();
    finger(store, 'down', { now: 0, panX: 5, panY: 7 });
    const effects = finger(store, 'move', { now: 100, x: PAN_SLOP + 3, y: 0 });
    expect(effects).toEqual([{ type: 'pdfPan', panX: 5 + PAN_SLOP + 3, panY: 7 }]);
    expect(store.session?.mode).toBe('pan');
  });

  test('長押しタイマーで静止 finger が range に入る', () => {
    const store = createPdfGestureStore();
    finger(store, 'down', { now: 0, x: 10, y: 10 });
    finger(store, 'move', { now: 50, x: 10, y: 10 });
    const effects = stepPdfLongPressTimer(store, LONG_PRESS_MS);
    expect(effects).toEqual([
      { type: 'pdfRangePreview', rect: { x: 10, y: 10, width: 0, height: 0 } },
    ]);
  });

  test('Pencil は no-op', () => {
    const store = createPdfGestureStore();
    const effects = stepPdfPointer(store, {
      pointerId: 2,
      kind: 'pencil',
      phase: 'down',
      x: 0,
      y: 0,
      now: 0,
      panX: 0,
      panY: 0,
    });
    expect(effects).toEqual([]);
    expect(store.session).toBeNull();
  });
});
