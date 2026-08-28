import { LONG_PRESS_MS, MIN_RANGE_CSS, PAN_SLOP } from './constants';
import { normalizeRect } from '../../domain/pdfLayout';
import type { Rect } from '../../domain/types';

export type PdfGestureMode = 'idle' | 'pending' | 'pan' | 'range' | 'pinch';

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
};

export type PdfGestureEffect =
  | { type: 'pdfPan'; panX: number; panY: number }
  | { type: 'pdfRangePreview'; rect: Rect }
  | { type: 'pdfRangeCommit'; rect: Rect }
  | { type: 'pdfRangeCancel' }
  | { type: 'cancelRangeForPinch' };

export type PdfPointerInput = {
  pointerId: number;
  kind: 'finger' | 'pencil';
  phase: 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
  now: number;
  panX: number;
  panY: number;
};

export type PdfGestureStore = {
  session: PdfGestureSession | null;
  pendingRange: Rect | null;
};

export function createPdfGestureStore(): PdfGestureStore {
  return { session: null, pendingRange: null };
}

function distance(session: PdfGestureSession, x: number, y: number): number {
  return Math.hypot(x - session.startX, y - session.startY);
}

function rangeFromSession(session: PdfGestureSession, x: number, y: number): Rect {
  return normalizeRect(session.startX, session.startY, x, y);
}

function commitRangeIfValid(
  rect: Rect,
): Extract<PdfGestureEffect, { type: 'pdfRangeCommit' }> | null {
  if (rect.width >= MIN_RANGE_CSS && rect.height >= MIN_RANGE_CSS) {
    return { type: 'pdfRangeCommit', rect };
  }
  return null;
}

/** §8.6 — finger pan vs long-press range on the PDF canvas. */
export function stepPdfPointer(
  store: PdfGestureStore,
  input: PdfPointerInput,
): PdfGestureEffect[] {
  if (input.kind === 'pencil') {
    return [];
  }

  const effects: PdfGestureEffect[] = [];

  if (input.phase === 'down') {
    store.session = {
      mode: 'pending',
      pointerId: input.pointerId,
      startX: input.x,
      startY: input.y,
      startedAt: input.now,
      lastX: input.x,
      lastY: input.y,
      panOriginX: input.panX,
      panOriginY: input.panY,
    };
    store.pendingRange = null;
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
    const elapsed = input.now - session.startedAt;

    if (session.mode === 'pending') {
      if (elapsed < LONG_PRESS_MS && dist >= PAN_SLOP) {
        session.mode = 'pan';
        effects.push({
          type: 'pdfPan',
          panX: session.panOriginX + (input.x - session.startX),
          panY: session.panOriginY + (input.y - session.startY),
        });
        return effects;
      }
      if (elapsed >= LONG_PRESS_MS && dist < PAN_SLOP) {
        session.mode = 'range';
        const rect = rangeFromSession(session, input.x, input.y);
        effects.push({ type: 'pdfRangePreview', rect });
        return effects;
      }
      return effects;
    }

    if (session.mode === 'pan') {
      effects.push({
        type: 'pdfPan',
        panX: session.panOriginX + (input.x - session.startX),
        panY: session.panOriginY + (input.y - session.startY),
      });
      return effects;
    }

    if (session.mode === 'range') {
      const rect = rangeFromSession(session, input.x, input.y);
      effects.push({ type: 'pdfRangePreview', rect });
      return effects;
    }

    return effects;
  }

  if (input.phase === 'up' || input.phase === 'cancel') {
    const dist = distance(session, input.x, input.y);
    const elapsed = input.now - session.startedAt;

    if (session.mode === 'pending') {
      if (elapsed >= LONG_PRESS_MS && dist < PAN_SLOP) {
        const rect = rangeFromSession(session, input.x, input.y);
        const commit = commitRangeIfValid(rect);
        if (commit) {
          store.pendingRange = commit.rect;
          effects.push(commit);
        } else {
          effects.push({ type: 'pdfRangeCancel' });
        }
      } else {
        effects.push({ type: 'pdfRangeCancel' });
      }
    } else if (session.mode === 'range') {
      const rect = rangeFromSession(session, input.x, input.y);
      const commit = commitRangeIfValid(rect);
      if (commit) {
        store.pendingRange = commit.rect;
        effects.push(commit);
      } else {
        effects.push({ type: 'pdfRangeCancel' });
      }
    }

    store.session = null;
    return effects;
  }

  return effects;
}

/** Enter range mode when the finger is held still (timer tick at LONG_PRESS_MS). */
export function stepPdfLongPressTimer(store: PdfGestureStore, now: number): PdfGestureEffect[] {
  const session = store.session;
  if (!session || session.mode !== 'pending') {
    return [];
  }
  if (now - session.startedAt < LONG_PRESS_MS) {
    return [];
  }
  const dist = distance(session, session.lastX, session.lastY);
  if (dist >= PAN_SLOP) {
    return [];
  }
  session.mode = 'range';
  const rect = rangeFromSession(session, session.lastX, session.lastY);
  return [{ type: 'pdfRangePreview', rect }];
}

export function cancelPdfRangeForPinch(store: PdfGestureStore): PdfGestureEffect[] {
  if (store.session?.mode === 'range' || store.session?.mode === 'pending') {
    store.session = null;
    store.pendingRange = null;
    return [{ type: 'cancelRangeForPinch' }, { type: 'pdfRangeCancel' }];
  }
  return [];
}

export function clearPdfPendingRange(store: PdfGestureStore): void {
  store.pendingRange = null;
}
