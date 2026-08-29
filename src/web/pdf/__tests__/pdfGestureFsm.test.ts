import { describe, expect, test } from 'vitest';
import { pdfPageViewerKey } from '../../../domain/pdfView';
import { PAN_SLOP } from '../../../domain/workspaceGestures';
import { createPdfGestureStore, stepPdfPointer } from '../pdfGestureFsm';

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
    hitIndex: null,
    handle: null,
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

describe('PDF 選択 vs パン', () => {
  test('グリフ上ドラッグは選択', () => {
    const store = createPdfGestureStore();
    finger(store, 'down', { hitIndex: 2, x: 10, y: 10 });
    const effects = finger(store, 'move', { hitIndex: 5, x: 10 + PAN_SLOP + 4, y: 10 });
    expect(effects.some((effect) => effect.type === 'pdfSelectionChange')).toBe(true);
    expect(store.session?.mode).toBe('select');
    expect(store.selection).toEqual({ startIndex: 2, endIndex: 5 });
  });

  test('空きの短いタップは選択解除', () => {
    const store = createPdfGestureStore();
    store.selection = { startIndex: 0, endIndex: 2 };
    finger(store, 'down', { now: 0, hitIndex: null });
    const cleared = finger(store, 'up', { now: 80, x: 1, y: 0, hitIndex: null });
    expect(cleared).toEqual([{ type: 'pdfSelectionClear' }]);
    expect(store.selection).toBeNull();
  });

  test('12px 超の空きドラッグはパン', () => {
    const store = createPdfGestureStore();
    finger(store, 'down', { now: 0, panX: 5, panY: 7, hitIndex: null });
    const effects = finger(store, 'move', { now: 100, x: PAN_SLOP + 3, y: 0, hitIndex: null });
    expect(effects).toEqual([{ type: 'pdfPan', panX: 5 + PAN_SLOP + 3, panY: 7 }]);
    expect(store.session?.mode).toBe('pan');
  });

  test('Pencil でもグリフ上ドラッグは選択', () => {
    const store = createPdfGestureStore();
    stepPdfPointer(store, {
      pointerId: 2,
      kind: 'pencil',
      phase: 'down',
      x: 10,
      y: 10,
      now: 0,
      panX: 0,
      panY: 0,
      hitIndex: 2,
    });
    const effects = stepPdfPointer(store, {
      pointerId: 2,
      kind: 'pencil',
      phase: 'move',
      x: 10 + PAN_SLOP + 4,
      y: 10,
      now: 1,
      panX: 0,
      panY: 0,
      hitIndex: 5,
    });
    expect(effects.some((effect) => effect.type === 'pdfSelectionChange')).toBe(true);
    expect(store.selection).toEqual({ startIndex: 2, endIndex: 5 });
  });
});
