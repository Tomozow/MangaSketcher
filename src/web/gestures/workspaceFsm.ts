import { resolvePointerIntent } from '../../domain/pointers';
import {
  canGrabPage,
  LONG_PRESS_MS,
  PAN_SLOP,
  preferHitForTool,
  TEXT_MOVE_SLOP,
  type GestureHit,
} from '../../domain/workspaceGestures';
import type { PageId, PointerKind, ToolId } from '../../domain/types';
import {
  angleFromCenter,
  clipWorldBounds,
  rotationFromHandleDrag,
  scaleFromCornerDrag,
} from '../clip/clipGeometry';
import type {
  WorkspaceEffect,
  WorkspaceGestureStore,
  WorkspaceHit,
  WorkspacePointerInput,
  WorkspaceSession,
} from './types';

function isTextBodyHit(
  hit: WorkspaceHit,
): hit is Extract<WorkspaceHit, { kind: 'pageText' | 'pasteboardText' }> {
  return hit.kind === 'pageText' || hit.kind === 'pasteboardText';
}

function isTextHandleHit(hit: WorkspaceHit): hit is Extract<WorkspaceHit, { kind: 'resizeHandle' }> {
  return hit.kind === 'resizeHandle';
}

function isPageBodyHit(hit: WorkspaceHit): hit is Extract<WorkspaceHit, { kind: 'page' }> {
  return hit.kind === 'page';
}

/** Reading-order insert index for workspace page reorder (append → -1 = end). */
export function reorderTargetIndex(hit: WorkspaceHit): number | null {
  switch (hit.kind) {
    case 'page':
    case 'pageNumber':
    case 'pageText':
      return hit.readingIndex;
    case 'slot':
      return hit.insertIndex;
    case 'append':
      return -1;
    default:
      return null;
  }
}

function isClipHit(hit: WorkspaceHit): hit is Extract<WorkspaceHit, { kind: 'clip' }> {
  return hit.kind === 'clip';
}

function isClipHandleHit(
  hit: WorkspaceHit,
): hit is Extract<WorkspaceHit, { kind: 'clip'; handle: 'body' | 'corner' | 'rotate' }> {
  return hit.kind === 'clip' && 'handle' in hit;
}

function preferWorkspaceHit(tool: ToolId, kind: PointerKind, hit: WorkspaceHit): WorkspaceHit {
  if (hit.kind === 'pageNumber' || hit.kind === 'append') {
    return hit;
  }
  if (kind === 'pencil' && tool === 'select') {
    if (hit.kind === 'pageText') {
      return {
        kind: 'page',
        pageId: hit.pageId,
        localX: hit.localX,
        localY: hit.localY,
        readingIndex: hit.readingIndex,
        insertIndex: hit.insertIndex,
      };
    }
    if (hit.kind === 'pasteboardText' || hit.kind === 'resizeHandle') {
      return { kind: 'empty' };
    }
  }
  return preferHitForTool(tool, kind, hit as GestureHit) as WorkspaceHit;
}

function isTapPending(session: WorkspaceSession, input: WorkspacePointerInput): boolean {
  if (session.mode !== 'fingerPending') {
    return false;
  }
  const dist = Math.hypot(input.x - session.startX, input.y - session.startY);
  return dist < PAN_SLOP && input.now - session.startedAt < LONG_PRESS_MS;
}

function tapEffects(
  hit: WorkspaceHit,
  selectedPageId: PageId | null,
): WorkspaceEffect[] {
  if (hit.kind === 'pageNumber') {
    if (selectedPageId !== hit.pageId) {
      return [{ type: 'selectPage', pageId: hit.pageId }];
    }
    return [{ type: 'insertAfterSelected' }];
  }
  if (hit.kind === 'append' || hit.kind === 'slot') {
    return [{ type: 'appendPage' }];
  }
  return [];
}

function fingerCount(store: WorkspaceGestureStore): number {
  let count = 0;
  for (const session of store.sessions.values()) {
    if (session.mode !== 'idle' && 'kind' in session && session.kind === 'finger') {
      count += 1;
    }
  }
  return count;
}

function activeFingerIds(store: WorkspaceGestureStore): number[] {
  const ids: number[] = [];
  for (const [id, session] of store.sessions) {
    if (session.mode !== 'idle' && 'kind' in session && session.kind === 'finger') {
      ids.push(id);
    }
  }
  return ids;
}

function pinchDistance(store: WorkspaceGestureStore, idA: number, idB: number): number {
  const a = store.fingerPositions.get(idA);
  const b = store.fingerPositions.get(idB);
  if (!a || !b) {
    return 1;
  }
  return Math.hypot(b.x - a.x, b.y - a.y) || 1;
}

function pinchMidDelta(
  store: WorkspaceGestureStore,
  idA: number,
  idB: number,
  prevA: { x: number; y: number },
  prevB: { x: number; y: number },
): { midDx: number; midDy: number } {
  const a = store.fingerPositions.get(idA)!;
  const b = store.fingerPositions.get(idB)!;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const prevMidX = (prevA.x + prevB.x) / 2;
  const prevMidY = (prevA.y + prevB.y) / 2;
  return { midDx: midX - prevMidX, midDy: midY - prevMidY };
}

function beginPinch(
  store: WorkspaceGestureStore,
  idA: number,
  idB: number,
): { sessionA: WorkspaceSession; sessionB: WorkspaceSession; dist: number } {
  const dist = pinchDistance(store, idA, idB);
  const session: WorkspaceSession = {
    mode: 'pinch',
    kind: 'finger',
    pointerId: idA,
    partnerId: idB,
    lastDist: dist,
  };
  return { sessionA: session, sessionB: { ...session, pointerId: idB, partnerId: idA }, dist };
}

function stepLockedPencil(
  session: WorkspaceSession,
  input: WorkspacePointerInput,
  hit: WorkspaceHit,
): { session: WorkspaceSession; effects: WorkspaceEffect[] } {
  if (session.mode === 'penOverlay') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'commitPenOverlay', pageId: session.pageId }],
      };
    }
    return {
      session: {
        ...session,
        lastX: input.x,
        lastY: input.y,
        lastPressure: input.pressure,
      },
      effects: [
        {
          type: 'penOverlayMove',
          pageId: session.pageId,
          points: [{ x: input.x, y: input.y, pressure: input.pressure }],
        },
      ],
    };
  }

  if (session.mode === 'eraseDirect') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'commitEraseDirect', pageId: session.pageId, clipId: session.clipId }],
      };
    }
    return {
      session,
      effects: [
        {
          type: 'eraseDirectMove',
          pageId: session.pageId,
          clipId: session.clipId,
          x: input.x,
          y: input.y,
          pressure: input.pressure,
        },
      ],
    };
  }

  if (session.mode === 'marquee') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      const rect = {
        x: Math.min(session.x0, session.x1),
        y: Math.min(session.y0, session.y1),
        width: Math.abs(session.x1 - session.x0),
        height: Math.abs(session.y1 - session.y0),
      };
      return { session: { mode: 'idle' }, effects: [{ type: 'completeMarquee', pageId: session.pageId, rect }] };
    }
    const lx = isPageBodyHit(hit) ? hit.localX : input.x;
    const ly = isPageBodyHit(hit) ? hit.localY : input.y;
    const next = { ...session, x1: lx, y1: ly };
    const rect = {
      x: Math.min(next.x0, next.x1),
      y: Math.min(next.y0, next.y1),
      width: Math.abs(next.x1 - next.x0),
      height: Math.abs(next.y1 - next.y0),
    };
    return {
      session: next,
      effects: [{ type: 'marqueePreview', pageId: session.pageId, rect }],
    };
  }

  if (session.mode === 'resizeText') {
    return {
      session,
      effects: [
        { type: 'selectText', textId: session.textId },
        { type: 'resizeText', textId: session.textId, x: input.x, y: input.y },
      ],
    };
  }

  if (session.mode === 'moveText') {
    const x = hit.kind === 'pageText' ? hit.localX : input.x;
    const y = hit.kind === 'pageText' ? hit.localY : input.y;
    return {
      session,
      effects: [
        { type: 'selectText', textId: session.textId },
        { type: 'moveText', textId: session.textId, x, y },
      ],
    };
  }

  if (session.mode === 'pendingTextMove') {
    const dist = Math.hypot(input.x - session.startX, input.y - session.startY);
    if (input.phase === 'up' || input.phase === 'cancel') {
      if (dist < TEXT_MOVE_SLOP) {
        return {
          session: { mode: 'idle' },
          effects: [{ type: 'selectText', textId: session.textId }],
        };
      }
      return { session: { mode: 'idle' }, effects: [] };
    }
    if (dist < TEXT_MOVE_SLOP) {
      return { session, effects: [] };
    }
    const x = hit.kind === 'pageText' ? hit.localX : input.x;
    const y = hit.kind === 'pageText' ? hit.localY : input.y;
    return {
      session: { mode: 'moveText', kind: 'pencil', textId: session.textId },
      effects: [
        { type: 'selectText', textId: session.textId },
        { type: 'moveText', textId: session.textId, x, y },
      ],
    };
  }

  if (session.mode === 'moveClip') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      const effects: WorkspaceEffect[] = [];
      if (isPageBodyHit(hit)) {
        effects.push({
          type: 'dropClipOnPage',
          clipId: session.clipId,
          pageId: hit.pageId,
          localX: hit.localX,
          localY: hit.localY,
        });
      }
      return { session: { mode: 'idle' }, effects };
    }
    return {
      session,
      effects: [
        {
          type: 'moveClip',
          clipId: session.clipId,
          x: input.x - session.offsetX,
          y: input.y - session.offsetY,
        },
      ],
    };
  }

  if (session.mode === 'scaleClip') {
    const dist = Math.hypot(input.x - session.cx, input.y - session.cy);
    const scale = scaleFromCornerDrag(session.startScale, session.startDist, dist);
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    return {
      session,
      effects: [{ type: 'scaleClip', clipId: session.clipId, scale }],
    };
  }

  if (session.mode === 'rotateClip') {
    const angle = angleFromCenter(session.cx, session.cy, input.x, input.y);
    const rotation = rotationFromHandleDrag(session.startRotation, session.startAngle, angle);
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    return {
      session,
      effects: [{ type: 'rotateClip', clipId: session.clipId, rotation }],
    };
  }

  return { session, effects: [] };
}

function stepPencilDown(
  input: WorkspacePointerInput,
  hit: WorkspaceHit,
): { session: WorkspaceSession; effects: WorkspaceEffect[] } {
  const intent = resolvePointerIntent(input.tool, { kind: 'pencil', phase: 'down' });

  if (intent.type === 'drawInk') {
    if (!isPageBodyHit(hit)) {
      return { session: { mode: 'idle' }, effects: [] };
    }
    return {
      session: {
        mode: 'penOverlay',
        kind: 'pencil',
        pageId: hit.pageId,
        lastX: hit.localX,
        lastY: hit.localY,
        lastPressure: input.pressure,
      },
      effects: [
        {
          type: 'beginPenOverlay',
          pageId: hit.pageId,
          x: hit.localX,
          y: hit.localY,
          pressure: input.pressure,
        },
      ],
    };
  }

  if (intent.type === 'eraseInk') {
    if (input.selectedClipId && isClipHit(hit) && hit.clipId === input.selectedClipId) {
      return {
        session: { mode: 'eraseDirect', kind: 'pencil', clipId: hit.clipId },
        effects: [{ type: 'beginEraseDirect', clipId: hit.clipId }],
      };
    }
    if (isPageBodyHit(hit)) {
      return {
        session: { mode: 'eraseDirect', kind: 'pencil', pageId: hit.pageId },
        effects: [{ type: 'beginEraseDirect', pageId: hit.pageId }],
      };
    }
    return { session: { mode: 'idle' }, effects: [] };
  }

  if (intent.type === 'selectMarquee') {
    if (isClipHit(hit)) {
      const clip = input.getClipMeta(hit.clipId);
      if (!clip) {
        return { session: { mode: 'idle' }, effects: [] };
      }
      if (isClipHandleHit(hit) && hit.handle === 'corner') {
        const bounds = clipWorldBounds(
          clip,
          input.getClipRasterSize(hit.clipId),
          input.rasterWidth,
          input.rasterHeight,
        );
        const startDist = Math.hypot(input.x - bounds.cx, input.y - bounds.cy);
        return {
          session: {
            mode: 'scaleClip',
            kind: 'pencil',
            clipId: hit.clipId,
            startScale: clip.scale,
            startDist,
            cx: bounds.cx,
            cy: bounds.cy,
          },
          effects: [{ type: 'selectClip', clipId: hit.clipId }],
        };
      }
      if (isClipHandleHit(hit) && hit.handle === 'rotate') {
        const bounds = clipWorldBounds(
          clip,
          input.getClipRasterSize(hit.clipId),
          input.rasterWidth,
          input.rasterHeight,
        );
        return {
          session: {
            mode: 'rotateClip',
            kind: 'pencil',
            clipId: hit.clipId,
            startRotation: clip.rotation,
            startAngle: angleFromCenter(bounds.cx, bounds.cy, input.x, input.y),
            cx: bounds.cx,
            cy: bounds.cy,
          },
          effects: [{ type: 'selectClip', clipId: hit.clipId }],
        };
      }
      return {
        session: {
          mode: 'moveClip',
          kind: 'pencil',
          clipId: hit.clipId,
          offsetX: input.x - clip.x,
          offsetY: input.y - clip.y,
        },
        effects: [
          { type: 'selectClip', clipId: hit.clipId },
          { type: 'moveClip', clipId: hit.clipId, x: clip.x, y: clip.y },
        ],
      };
    }
    if (isPageBodyHit(hit)) {
      return {
        session: {
          mode: 'marquee',
          kind: 'pencil',
          pageId: hit.pageId,
          x0: hit.localX,
          y0: hit.localY,
          x1: hit.localX,
          y1: hit.localY,
        },
        effects: [
          {
            type: 'marqueePreview',
            pageId: hit.pageId,
            rect: { x: hit.localX, y: hit.localY, width: 0, height: 0 },
          },
        ],
      };
    }
    return { session: { mode: 'idle' }, effects: [] };
  }

  if (intent.type === 'textEdit') {
    if (isTextHandleHit(hit)) {
      return {
        session: { mode: 'resizeText', kind: 'pencil', textId: hit.textId },
        effects: [
          { type: 'selectText', textId: hit.textId },
          { type: 'resizeText', textId: hit.textId, x: input.x, y: input.y },
        ],
      };
    }
    if (isTextBodyHit(hit)) {
      return {
        session: {
          mode: 'pendingTextMove',
          kind: 'pencil',
          textId: hit.textId,
          startX: input.x,
          startY: input.y,
        },
        effects: [],
      };
    }
    if (isPageBodyHit(hit)) {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'createText', pageId: hit.pageId, x: hit.localX, y: hit.localY }],
      };
    }
  }

  return { session: { mode: 'idle' }, effects: [] };
}

function stepFinger(
  store: WorkspaceGestureStore,
  session: WorkspaceSession,
  input: WorkspacePointerInput,
): { session: WorkspaceSession; effects: WorkspaceEffect[] } {
  if (session.mode === 'pan') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    return {
      session: { mode: 'pan', kind: 'finger', lastX: input.x, lastY: input.y },
      effects: [{ type: 'panBy', dx: input.x - session.lastX, dy: input.y - session.lastY }],
    };
  }

  if (session.mode === 'grabPage') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    const toIndex = reorderTargetIndex(input.hit);
    if (toIndex === null || toIndex === session.lastToIndex) {
      return { session, effects: [] };
    }
    return {
      session: { ...session, lastToIndex: toIndex },
      effects: [{ type: 'reorderWorkspace', pageId: session.pageId, toIndex }],
    };
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
      if (isTapPending(session, input)) {
        return {
          session: { mode: 'idle' },
          effects: tapEffects(session.hit, input.selectedPageId),
        };
      }
      return { session: { mode: 'idle' }, effects: [] };
    }

    const dist = Math.hypot(input.x - session.startX, input.y - session.startY);
    if (dist >= PAN_SLOP) {
      return {
        session: { mode: 'pan', kind: 'finger', lastX: input.x, lastY: input.y },
        effects: [{ type: 'panBy', dx: input.x - session.startX, dy: input.y - session.startY }],
      };
    }
    if (
      input.now - session.startedAt >= LONG_PRESS_MS &&
      isPageBodyHit(session.hit) &&
      canGrabPage('finger', 'longpress')
    ) {
      return {
        session: {
          mode: 'grabPage',
          kind: 'finger',
          pageId: session.hit.pageId,
          fromIndex: session.hit.readingIndex,
        },
        effects: [
          {
            type: 'grabPage',
            pageId: session.hit.pageId,
            fromIndex: session.hit.readingIndex,
          },
        ],
      };
    }
    return { session, effects: [] };
  }

  return { session, effects: [] };
}

function stepFingerDown(
  store: WorkspaceGestureStore,
  input: WorkspacePointerInput,
): { session: WorkspaceSession; effects: WorkspaceEffect[]; ignored: boolean } {
  const fingers = fingerCount(store);
  if (!input.isPrimary && fingers >= 2) {
    return { session: { mode: 'idle' }, effects: [], ignored: true };
  }

  store.fingerPositions.set(input.pointerId, { x: input.x, y: input.y });

  const existingFingers = activeFingerIds(store).filter((id) => id !== input.pointerId);
  if (existingFingers.length >= 1) {
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

/**
 * Advance one pointer's workspace gesture session. Does not call stepWorkspaceGesture.
 */
export function stepWorkspacePointer(
  store: WorkspaceGestureStore,
  input: WorkspacePointerInput,
): { effects: WorkspaceEffect[]; ignored: boolean } {
  const hit = preferWorkspaceHit(input.tool, input.kind, input.hit);
  const normalized = { ...input, hit };
  let session = store.sessions.get(input.pointerId) ?? { mode: 'idle' as const };

  if (input.kind === 'finger') {
    if (input.phase === 'down') {
      const down = stepFingerDown(store, normalized);
      if (!down.ignored) {
        store.sessions.set(input.pointerId, down.session);
      }
      return { effects: down.effects, ignored: down.ignored };
    }

    if (session.mode === 'idle') {
      return { effects: [], ignored: false };
    }

    if (input.phase === 'move') {
      store.fingerPositions.set(input.pointerId, { x: input.x, y: input.y });
    }

    const stepped = stepFinger(store, session, normalized);
    if (input.phase === 'up' || input.phase === 'cancel') {
      store.sessions.delete(input.pointerId);
      store.fingerPositions.delete(input.pointerId);
    } else {
      store.sessions.set(input.pointerId, stepped.session);
    }
    return { effects: stepped.effects, ignored: false };
  }

  // Pencil
  if (session.mode !== 'idle' && 'kind' in session && session.kind === 'pencil') {
    const stepped = stepLockedPencil(session, normalized, hit);
    if (input.phase === 'up' || input.phase === 'cancel') {
      store.sessions.delete(input.pointerId);
    } else {
      store.sessions.set(input.pointerId, stepped.session);
    }
    return { effects: stepped.effects, ignored: false };
  }

  if (input.phase === 'down') {
    const down = stepPencilDown(normalized, hit);
    if (down.session.mode !== 'idle') {
      store.sessions.set(input.pointerId, down.session);
    }
    return { effects: down.effects, ignored: false };
  }

  return { effects: [], ignored: false };
}

export function getWorkspaceSession(
  store: WorkspaceGestureStore,
  pointerId: number,
): WorkspaceSession | undefined {
  return store.sessions.get(pointerId);
}

export function countActiveTouches(store: WorkspaceGestureStore, kind?: PointerKind): number {
  let n = 0;
  for (const session of store.sessions.values()) {
    if (session.mode === 'idle' || !('kind' in session)) {
      continue;
    }
    if (kind === undefined || session.kind === kind) {
      n += 1;
    }
  }
  return n;
}
