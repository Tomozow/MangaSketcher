import { PAN_SLOP } from './constants';

export type PdfGestureMode =
  | 'pendingPan'
  | 'pendingSelect'
  | 'pan'
  | 'select'
  | 'adjustStart'
  | 'adjustEnd';

export type PdfSelection = {
  startIndex: number;
  endIndex: number;
};

export type PdfGestureSession = {
  mode: PdfGestureMode;
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  lastX: number;
  lastY: number;
  panOriginX: number;
  panOriginY: number;
  startIndex: number;
  endIndex: number;
};

export type PdfGestureEffect =
  | { type: 'pdfPan'; panX: number; panY: number }
  | { type: 'pdfSelectionChange'; startIndex: number; endIndex: number }
  | { type: 'pdfSelectionCommit'; startIndex: number; endIndex: number }
  | { type: 'pdfSelectionClear' }
  | { type: 'cancelSelectionForPinch' };

export type PdfPointerInput = {
  pointerId: number;
  kind: 'finger' | 'pencil';
  phase: 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
  now: number;
  panX: number;
  panY: number;
  hitIndex?: number | null;
  handle?: 'start' | 'end' | null;
};

export type PdfGestureStore = {
  session: PdfGestureSession | null;
  selection: PdfSelection | null;
};

export function createPdfGestureStore(): PdfGestureStore {
  return { session: null, selection: null };
}

function distance(session: PdfGestureSession, x: number, y: number): number {
  return Math.hypot(x - session.startX, y - session.startY);
}

function normalizeSelection(startIndex: number, endIndex: number): PdfSelection {
  return {
    startIndex: Math.min(startIndex, endIndex),
    endIndex: Math.max(startIndex, endIndex),
  };
}

function applyLiveSelection(store: PdfGestureStore, startIndex: number, endIndex: number): PdfGestureEffect {
  const next = normalizeSelection(startIndex, endIndex);
  store.selection = next;
  return { type: 'pdfSelectionChange', startIndex: next.startIndex, endIndex: next.endIndex };
}

/** Finger or Pencil: glyph drag selects, empty drag pans. Hover (buttons 0) is ignored by the viewer. */
export function stepPdfPointer(
  store: PdfGestureStore,
  input: PdfPointerInput,
): PdfGestureEffect[] {
  const hitIndex = input.hitIndex ?? null;
  const handle = input.handle ?? null;
  const effects: PdfGestureEffect[] = [];

  if (input.phase === 'down') {
    if (handle === 'start' && store.selection) {
      store.session = {
        mode: 'adjustStart',
        pointerId: input.pointerId,
        startX: input.x,
        startY: input.y,
        startedAt: input.now,
        lastX: input.x,
        lastY: input.y,
        panOriginX: input.panX,
        panOriginY: input.panY,
        startIndex: store.selection.startIndex,
        endIndex: store.selection.endIndex,
      };
      return effects;
    }
    if (handle === 'end' && store.selection) {
      store.session = {
        mode: 'adjustEnd',
        pointerId: input.pointerId,
        startX: input.x,
        startY: input.y,
        startedAt: input.now,
        lastX: input.x,
        lastY: input.y,
        panOriginX: input.panX,
        panOriginY: input.panY,
        startIndex: store.selection.startIndex,
        endIndex: store.selection.endIndex,
      };
      return effects;
    }
    if (hitIndex != null && hitIndex >= 0) {
      store.session = {
        mode: 'pendingSelect',
        pointerId: input.pointerId,
        startX: input.x,
        startY: input.y,
        startedAt: input.now,
        lastX: input.x,
        lastY: input.y,
        panOriginX: input.panX,
        panOriginY: input.panY,
        startIndex: hitIndex,
        endIndex: hitIndex,
      };
      effects.push(applyLiveSelection(store, hitIndex, hitIndex));
      return effects;
    }
    store.session = {
      mode: 'pendingPan',
      pointerId: input.pointerId,
      startX: input.x,
      startY: input.y,
      startedAt: input.now,
      lastX: input.x,
      lastY: input.y,
      panOriginX: input.panX,
      panOriginY: input.panY,
      startIndex: 0,
      endIndex: 0,
    };
    return effects;
  }

  const session = store.session;
  if (!session || session.pointerId !== input.pointerId) {
    return effects;
  }

  if (input.phase === 'move') {
    session.lastX = input.x;
    session.lastY = input.y;
    const dist = distance(session, input.x, input.y);

    if (session.mode === 'pendingPan') {
      if (dist >= PAN_SLOP) {
        session.mode = 'pan';
        effects.push({
          type: 'pdfPan',
          panX: session.panOriginX + (input.x - session.startX),
          panY: session.panOriginY + (input.y - session.startY),
        });
      }
      return effects;
    }

    if (session.mode === 'pendingSelect') {
      if (dist >= PAN_SLOP) {
        session.mode = 'select';
      }
      if (hitIndex != null && hitIndex >= 0) {
        session.endIndex = hitIndex;
        effects.push(applyLiveSelection(store, session.startIndex, session.endIndex));
      }
      return effects;
    }

    if (session.mode === 'select' && hitIndex != null && hitIndex >= 0) {
      session.endIndex = hitIndex;
      effects.push(applyLiveSelection(store, session.startIndex, session.endIndex));
      return effects;
    }

    if (session.mode === 'adjustStart' && hitIndex != null && hitIndex >= 0) {
      session.startIndex = hitIndex;
      effects.push(applyLiveSelection(store, session.startIndex, session.endIndex));
      return effects;
    }

    if (session.mode === 'adjustEnd' && hitIndex != null && hitIndex >= 0) {
      session.endIndex = hitIndex;
      effects.push(applyLiveSelection(store, session.startIndex, session.endIndex));
      return effects;
    }

    if (session.mode === 'pan') {
      effects.push({
        type: 'pdfPan',
        panX: session.panOriginX + (input.x - session.startX),
        panY: session.panOriginY + (input.y - session.startY),
      });
    }
    return effects;
  }

  if (input.phase === 'up' || input.phase === 'cancel') {
    const dist = distance(session, input.x, input.y);
    if (session.mode === 'pendingPan') {
      if (input.phase === 'up' && dist < PAN_SLOP) {
        store.selection = null;
        effects.push({ type: 'pdfSelectionClear' });
      }
    } else if (
      session.mode === 'pendingSelect' ||
      session.mode === 'select' ||
      session.mode === 'adjustStart' ||
      session.mode === 'adjustEnd'
    ) {
      const next = normalizeSelection(session.startIndex, session.endIndex);
      store.selection = next;
      effects.push({
        type: 'pdfSelectionCommit',
        startIndex: next.startIndex,
        endIndex: next.endIndex,
      });
    }
    store.session = null;
    return effects;
  }

  return effects;
}

export function cancelPdfSelectionForPinch(store: PdfGestureStore): PdfGestureEffect[] {
  if (!store.session) {
    return [];
  }
  store.session = null;
  return [{ type: 'cancelSelectionForPinch' }];
}

/** @deprecated Use cancelPdfSelectionForPinch */
export function cancelPdfRangeForPinch(store: PdfGestureStore): PdfGestureEffect[] {
  return cancelPdfSelectionForPinch(store);
}

export function clearPdfSelection(store: PdfGestureStore): void {
  store.selection = null;
  store.session = null;
}
