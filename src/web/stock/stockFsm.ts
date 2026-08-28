import { stockPointerPolicy } from '../../domain/pointers';
import { LONG_PRESS_MS, PAN_SLOP } from '../../domain/workspaceGestures';
import type { PointerKind, PageId } from '../../domain/types';
import type { StockEffect, StockGestureStore, StockHit, StockSession } from './types';

export type StockPointerInput = {
  pointerId: number;
  kind: PointerKind;
  phase: 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
  hit: StockHit;
  now: number;
  isPrimary: boolean;
  layout: 'free' | 'grid';
};

function fingerCount(store: StockGestureStore): number {
  return [...store.sessions.values()].filter((s) => s.mode !== 'idle' && 'kind' in s && s.kind === 'finger')
    .length;
}

function activeFingerIds(store: StockGestureStore): number[] {
  return [...store.sessions.entries()]
    .filter(([, s]) => s.mode !== 'idle' && 'kind' in s && s.kind === 'finger')
    .map(([id]) => id);
}

function pinchDistance(store: StockGestureStore, a: number, b: number): number {
  const pa = store.fingerPositions.get(a);
  const pb = store.fingerPositions.get(b);
  if (!pa || !pb) {
    return 1;
  }
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

function pinchMidDelta(
  store: StockGestureStore,
  a: number,
  b: number,
  prevA: { x: number; y: number },
  prevB: { x: number; y: number },
): { midDx: number; midDy: number } {
  const pa = store.fingerPositions.get(a) ?? prevA;
  const pb = store.fingerPositions.get(b) ?? prevB;
  const prevMidX = (prevA.x + prevB.x) / 2;
  const prevMidY = (prevA.y + prevB.y) / 2;
  const midX = (pa.x + pb.x) / 2;
  const midY = (pa.y + pb.y) / 2;
  return { midDx: midX - prevMidX, midDy: midY - prevMidY };
}

function beginPinch(
  store: StockGestureStore,
  pointerId: number,
  partnerId: number,
): { sessionA: StockSession; sessionB: StockSession } {
  const dist = pinchDistance(store, pointerId, partnerId);
  const pinchSession = {
    mode: 'pinch' as const,
    kind: 'finger' as const,
    pointerId,
    partnerId,
    lastDist: dist,
  };
  return { sessionA: pinchSession, sessionB: pinchSession };
}

function stepFinger(
  store: StockGestureStore,
  session: StockSession,
  input: StockPointerInput,
): { session: StockSession; effects: StockEffect[] } {
  if (session.mode === 'pan') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    return {
      session: { mode: 'pan', kind: 'finger', lastX: input.x, lastY: input.y },
      effects: [{ type: 'panBy', dx: input.x - session.lastX, dy: input.y - session.lastY }],
    };
  }

  if (session.mode === 'dragPage') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    return { session, effects: [] };
  }

  if (session.mode === 'pinch') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    const partnerId = session.partnerId;
    const prevA = store.fingerPositions.get(session.pointerId) ?? { x: input.x, y: input.y };
    const prevB = store.fingerPositions.get(partnerId) ?? { x: input.x, y: input.y };
    store.fingerPositions.set(input.pointerId, { x: input.x, y: input.y });
    const dist = pinchDistance(store, session.pointerId, partnerId);
    const scaleBy = dist / Math.max(1, session.lastDist);
    const { midDx, midDy } = pinchMidDelta(store, session.pointerId, partnerId, prevA, prevB);
    return {
      session: { ...session, lastDist: dist },
      effects: [{ type: 'pinchBy', scaleBy, midDx, midDy }],
    };
  }

  if (session.mode === 'fingerPending') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }

    const dist = Math.hypot(input.x - session.startX, input.y - session.startY);
    if (dist >= PAN_SLOP) {
      if (session.hit.kind === 'thumb' && stockPointerPolicy('finger').dragPage) {
        return {
          session: { mode: 'dragPage', kind: 'finger', pageId: session.hit.pageId },
          effects: [{ type: 'dragPage', pageId: session.hit.pageId }],
        };
      }
      if (input.layout === 'free' && stockPointerPolicy('finger').pan) {
        return {
          session: { mode: 'pan', kind: 'finger', lastX: input.x, lastY: input.y },
          effects: [{ type: 'panBy', dx: input.x - session.startX, dy: input.y - session.startY }],
        };
      }
      return { session: { mode: 'idle' }, effects: [] };
    }

    if (
      input.now - session.startedAt >= LONG_PRESS_MS &&
      session.hit.kind === 'thumb' &&
      stockPointerPolicy('finger').dragPage
    ) {
      return {
        session: { mode: 'dragPage', kind: 'finger', pageId: session.hit.pageId },
        effects: [{ type: 'dragPage', pageId: session.hit.pageId }],
      };
    }

    return { session, effects: [] };
  }

  return { session, effects: [] };
}

function stepFingerDown(
  store: StockGestureStore,
  input: StockPointerInput,
): { session: StockSession; effects: StockEffect[]; ignored: boolean } {
  const fingers = fingerCount(store);
  if (!input.isPrimary && fingers >= 2) {
    return { session: { mode: 'idle' }, effects: [], ignored: true };
  }

  store.fingerPositions.set(input.pointerId, { x: input.x, y: input.y });

  const existingFingers = activeFingerIds(store).filter((id) => id !== input.pointerId);
  if (input.layout === 'free' && existingFingers.length >= 1) {
    const partnerId = existingFingers[0]!;
    const { sessionA, sessionB } = beginPinch(store, input.pointerId, partnerId);
    store.sessions.set(partnerId, sessionB);
    return { session: sessionA, effects: [], ignored: false };
  }

  return {
    session: {
      mode: 'fingerPending',
      kind: 'finger',
      hit: input.hit,
      startX: input.x,
      startY: input.y,
      startedAt: input.now,
    },
    effects: [],
    ignored: false,
  };
}

export function stepStockPointer(
  store: StockGestureStore,
  input: StockPointerInput,
): { effects: StockEffect[] } {
  if (input.kind === 'pencil') {
    return { effects: [] };
  }

  if (input.phase === 'down') {
    const { session, effects, ignored } = stepFingerDown(store, input);
    if (!ignored) {
      store.sessions.set(input.pointerId, session);
    }
    return { effects };
  }

  const session = store.sessions.get(input.pointerId) ?? { mode: 'idle' as const };
  if (session.mode === 'idle') {
    return { effects: [] };
  }

  const { session: next, effects } = stepFinger(store, session, input);
  if (next.mode === 'idle') {
    store.sessions.delete(input.pointerId);
    store.fingerPositions.delete(input.pointerId);
  } else {
    store.sessions.set(input.pointerId, next);
  }

  if (input.phase === 'up' || input.phase === 'cancel') {
    store.fingerPositions.delete(input.pointerId);
  } else {
    store.fingerPositions.set(input.pointerId, { x: input.x, y: input.y });
  }

  return { effects };
}

export function getStockDragPageId(store: StockGestureStore): PageId | null {
  for (const session of store.sessions.values()) {
    if (session.mode === 'dragPage') {
      return session.pageId;
    }
  }
  return null;
}