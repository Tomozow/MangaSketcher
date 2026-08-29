import { resolvePointerIntent } from '../../domain/pointers';
import {
  canGrabPage,
  LONG_PRESS_MS,
  PAN_SLOP,
  preferHitForTool,
  TEXT_MOVE_SLOP,
  type GestureHit,
} from '../../domain/workspaceGestures';
import type { PageId, PointerKind, TextId, ToolId } from '../../domain/types';
import { clampRasterPoint } from '../../domain/stripGeometry';
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
import { MIN_MARQUEE_RASTER_PX } from '../clip/constants';

function isTextBodyHit(
  hit: WorkspaceHit,
): hit is Extract<WorkspaceHit, { kind: 'pageText' | 'pasteboardText' }> {
  return hit.kind === 'pageText' || hit.kind === 'pasteboardText';
}

type TextMoveSession = {
  textId: TextId;
  grabOffsetX: number;
  grabOffsetY: number;
  pageId?: PageId;
  where: 'page' | 'pasteboard';
};

function finiteGrabOffset(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

function clipCenterPageDrop(
  session: Extract<WorkspaceSession, { mode: 'moveClip' }>,
  input: WorkspacePointerInput,
): { pageId: PageId; localX: number; localY: number } | null {
  const clip = input.getClipMeta(session.clipId);
  if (!clip) {
    return null;
  }
  const liveX = input.worldX - session.offsetX;
  const liveY = input.worldY - session.offsetY;
  const bounds = clipWorldBounds(
    { ...clip, x: liveX, y: liveY },
    input.getClipRasterSize(session.clipId),
    input.rasterWidth,
    input.rasterHeight,
  );
  if (input.pageInkAtWorld) {
    const origin = input.pageInkAtWorld(liveX, liveY);
    const center = input.pageInkAtWorld(bounds.cx, bounds.cy);
    if (!origin || !center || origin.pageId !== center.pageId) {
      return null;
    }
    return center;
  }
  const drop = input.dropHit ?? input.hit;
  if (drop.kind !== 'page' && drop.kind !== 'pageText') {
    return null;
  }
  const local = input.mapWorldToPage?.(drop.pageId, bounds.cx, bounds.cy);
  if (!local) {
    return null;
  }
  if (
    local.x < 0 ||
    local.x > input.rasterWidth ||
    local.y < 0 ||
    local.y > input.rasterHeight
  ) {
    return null;
  }
  return { pageId: drop.pageId, localX: local.x, localY: local.y };
}

function textMoveSessionFromHit(hit: WorkspaceHit): TextMoveSession | null {
  if (hit.kind === 'pageText') {
    return {
      textId: hit.textId,
      grabOffsetX: finiteGrabOffset(hit.grabOffsetX),
      grabOffsetY: finiteGrabOffset(hit.grabOffsetY),
      pageId: hit.pageId,
      where: 'page',
    };
  }
  if (hit.kind === 'pasteboardText') {
    return {
      textId: hit.textId,
      grabOffsetX: finiteGrabOffset(hit.grabOffsetX),
      grabOffsetY: finiteGrabOffset(hit.grabOffsetY),
      where: 'pasteboard',
    };
  }
  return null;
}

function textMovePoint(
  session: TextMoveSession,
  input: WorkspacePointerInput,
): { x: number; y: number; pageId?: PageId; pasteboard?: boolean } | null {
  const worldX = input.worldX - session.grabOffsetX;
  const worldY = input.worldY - session.grabOffsetY;
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;

  const dropHit = input.dropHit ?? input.hit;
  if ((dropHit.kind === 'page' || dropHit.kind === 'pageText') && input.mapWorldToPage) {
    const local = input.mapWorldToPage(dropHit.pageId, worldX, worldY);
    if (local && Number.isFinite(local.x) && Number.isFinite(local.y)) {
      return { x: local.x, y: local.y, pageId: dropHit.pageId };
    }
  }
  return { x: worldX, y: worldY, pasteboard: true };
}

function textMoveEffects(
  session: TextMoveSession,
  input: WorkspacePointerInput,
  phase: WorkspacePointerInput['phase'],
): WorkspaceEffect[] {
  if (phase === 'cancel') {
    return [{ type: 'cancelTextTransform', textId: session.textId }];
  }
  const point = textMovePoint(session, input);
  if (!point) {
    return [];
  }
  const { x, y, pageId, pasteboard } = point;
  if (phase === 'up') {
    return [{ type: 'commitTextTransform', textId: session.textId, x, y, pageId, pasteboard }];
  }
  return [
    { type: 'textTransformLive', textId: session.textId, x, y, pageId, pasteboard },
  ];
}

function isTextHandleHit(hit: WorkspaceHit): hit is Extract<WorkspaceHit, { kind: 'resizeHandle' }> {
  return hit.kind === 'resizeHandle';
}

function isPageBodyHit(hit: WorkspaceHit): hit is Extract<WorkspaceHit, { kind: 'page' }> {
  return hit.kind === 'page';
}

function isChromeTapHit(hit: WorkspaceHit): boolean {
  return hit.kind === 'pageNumber' || hit.kind === 'append' || hit.kind === 'slot';
}

function inkRasterPoint(
  hit: WorkspaceHit,
  fallbackX: number,
  fallbackY: number,
  lockedPageId: PageId | undefined,
  input: WorkspacePointerInput,
): { x: number; y: number } {
  if (lockedPageId && input.mapInkToPage) {
    const mapped = input.mapInkToPage(lockedPageId, input.x, input.y);
    if (mapped) {
      return mapped;
    }
  }
  if ((hit.kind === 'page' || hit.kind === 'pageText') && hit.pageId === lockedPageId) {
    return clampRasterPoint(hit.localX, hit.localY, input.rasterWidth, input.rasterHeight);
  }
  return { x: fallbackX, y: fallbackY };
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

function tapHitForEffects(
  sessionHit: WorkspaceHit,
  input: WorkspacePointerInput,
): WorkspaceHit {
  if (input.tool === 'text') {
    return input.hit;
  }
  return sessionHit;
}

function createTextCoords(
  hit: Extract<WorkspaceHit, { kind: 'page' }>,
  input: WorkspacePointerInput,
): { x: number; y: number } | null {
  const dom = input.mapPageDomLocal?.(hit.pageId, input.x, input.y);
  if (dom) {
    return dom;
  }
  return Number.isFinite(hit.localX) && Number.isFinite(hit.localY)
    ? { x: hit.localX, y: hit.localY }
    : null;
}

function tapEffects(
  hit: WorkspaceHit,
  _selectedPageId: PageId | null,
  tool: ToolId,
  input?: WorkspacePointerInput,
): WorkspaceEffect[] {
  if (hit.kind === 'pageNumber') {
    return [
      { type: 'selectPage', pageId: hit.pageId },
      { type: 'showPageDelete', pageId: hit.pageId },
    ];
  }
  if (hit.kind === 'append') {
    if (tool === 'text') {
      return [];
    }
    return [{ type: 'appendPage' }];
  }
  if (hit.kind === 'slot') {
    return [];
  }
  if (tool === 'text' && hit.kind === 'page') {
    if (!input) {
      return [];
    }
    const coords = createTextCoords(hit, input);
    if (!coords) {
      return [];
    }
    return [{ type: 'createText', pageId: hit.pageId, x: coords.x, y: coords.y }];
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
  const a = store.fingerPositions.get(idA);
  const b = store.fingerPositions.get(idB);
  if (!a || !b) {
    return { midDx: 0, midDy: 0 };
  }
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const prevMidX = (prevA.x + prevB.x) / 2;
  const prevMidY = (prevA.y + prevB.y) / 2;
  return { midDx: midX - prevMidX, midDy: midY - prevMidY };
}

function demotePinchPartner(store: WorkspaceGestureStore, partnerId: number): void {
  const partner = store.sessions.get(partnerId);
  if (partner?.mode !== 'pinch') {
    return;
  }
  const pos = store.fingerPositions.get(partnerId);
  store.sessions.set(partnerId, {
    mode: 'pan',
    kind: 'finger',
    lastX: pos?.x ?? 0,
    lastY: pos?.y ?? 0,
  });
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

function stepTextDrag(
  session: WorkspaceSession,
  input: WorkspacePointerInput,
): { session: WorkspaceSession; effects: WorkspaceEffect[] } | null {
  if (session.mode === 'moveText') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: textMoveEffects(session, input, input.phase),
      };
    }
    return {
      session,
      effects: textMoveEffects(session, input, input.phase),
    };
  }

  if (session.mode === 'pendingTextMove') {
    const dist = Math.hypot(input.x - session.startX, input.y - session.startY);
    if (input.phase === 'up' || input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'selectText', textId: session.textId }],
      };
    }
    if (dist < TEXT_MOVE_SLOP) {
      return { session, effects: [] };
    }
    const moveSession: TextMoveSession = {
      textId: session.textId,
      grabOffsetX: session.grabOffsetX,
      grabOffsetY: session.grabOffsetY,
      pageId: session.pageId,
      where: session.where,
    };
    return {
      session: { mode: 'moveText', kind: session.kind, ...moveSession },
      effects: [
        { type: 'selectText', textId: session.textId },
        ...textMoveEffects(moveSession, input, input.phase),
      ],
    };
  }

  if (session.mode === 'pendingTextCreate') {
    if (input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    if (input.phase === 'up') {
      const pageHit: Extract<WorkspaceHit, { kind: 'page' }> = {
        kind: 'page',
        pageId: session.pageId,
        localX: session.localX,
        localY: session.localY,
        readingIndex: 0,
        insertIndex: 0,
      };
      const coords = createTextCoords(pageHit, {
        ...input,
        x: session.startX,
        y: session.startY,
      });
      if (!coords) {
        return { session: { mode: 'idle' }, effects: [] };
      }
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'createText', pageId: session.pageId, x: coords.x, y: coords.y }],
      };
    }
    return { session, effects: [] };
  }

  return null;
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
    const point = inkRasterPoint(hit, session.lastX, session.lastY, session.pageId, input);
    return {
      session: {
        ...session,
        lastX: point.x,
        lastY: point.y,
        lastPressure: input.pressure,
      },
      effects: [
        {
          type: 'penOverlayMove',
          pageId: session.pageId,
          points: [{ x: point.x, y: point.y, pressure: input.pressure }],
        },
      ],
    };
  }

  if (session.mode === 'eraseDirect') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'commitEraseDirect', pageId: session.pageId }],
      };
    }
    const point = inkRasterPoint(hit, input.x, input.y, session.pageId, input);
    return {
      session,
      effects: [
        {
          type: 'eraseDirectMove',
          pageId: session.pageId,
          x: point.x,
          y: point.y,
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
      return {
        session: { mode: 'idle' },
        effects:
          rect.width < MIN_MARQUEE_RASTER_PX || rect.height < MIN_MARQUEE_RASTER_PX
            ? []
            : [{ type: 'completeMarquee', pageId: session.pageId, rect }],
      };
    }
    const point = inkRasterPoint(hit, session.x1, session.y1, session.pageId, input);
    const next = { ...session, x1: point.x, y1: point.y };
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
    if (input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'cancelTextResize', textId: session.textId }],
      };
    }
    const start = session.startWorldBox;
    const scale = Math.max(
      0.15,
      (input.worldX - start.x) / Math.max(1, start.width),
      (input.worldY - start.y) / Math.max(1, start.height),
    );
    const worldBox = {
      x: start.x,
      y: start.y,
      width: Math.max(4, start.width * scale),
      height: Math.max(4, start.height * scale),
    };
    let box = worldBox;
    if (session.owner === 'page' && session.pageId && input.mapWorldToPage) {
      const origin = input.mapWorldToPage(session.pageId, worldBox.x, worldBox.y);
      const corner = input.mapWorldToPage(
        session.pageId,
        worldBox.x + worldBox.width,
        worldBox.y + worldBox.height,
      );
      if (origin && corner) {
        box = {
          x: origin.x,
          y: origin.y,
          width: Math.max(4, corner.x - origin.x),
          height: Math.max(4, corner.y - origin.y),
        };
      }
    }
    return {
      session: input.phase === 'up' ? { mode: 'idle' } : session,
      effects: [
        { type: 'selectText', textId: session.textId },
        input.phase === 'up'
          ? { type: 'commitTextResize', textId: session.textId, box }
          : { type: 'textResizeLive', textId: session.textId, box },
      ],
    };
  }

  const textDrag = stepTextDrag(session, input);
  if (textDrag) {
    return textDrag;
  }

  if (session.mode === 'pendingChromeTap') {
    const dist = Math.hypot(input.x - session.startX, input.y - session.startY);
    if (input.phase === 'up' || input.phase === 'cancel') {
      if (dist < PAN_SLOP) {
        const tapHit = tapHitForEffects(session.hit, input);
        return {
          session: { mode: 'idle' },
          effects: tapEffects(tapHit, input.selectedPageId, input.tool, input),
        };
      }
      return { session: { mode: 'idle' }, effects: [] };
    }
    return { session, effects: [] };
  }

  if (session.mode === 'moveClip') {
    if (input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'cancelClipTransform', clipId: session.clipId }],
      };
    }
    const clipLiveEffect: WorkspaceEffect = {
      type: 'clipTransformLive',
      clipId: session.clipId,
      x: input.worldX - session.offsetX,
      y: input.worldY - session.offsetY,
    };
    if (input.phase === 'up') {
      const centerDrop = clipCenterPageDrop(session, input);
      return {
        session: { mode: 'idle' },
        effects: centerDrop
          ? [
              clipLiveEffect,
              {
                type: 'dropClipOnPage',
                clipId: session.clipId,
                pageId: centerDrop.pageId,
                localX: centerDrop.localX,
                localY: centerDrop.localY,
              },
            ]
          : [clipLiveEffect, { type: 'commitClipTransform', clipId: session.clipId }],
      };
    }
    return {
      session,
      effects: [clipLiveEffect],
    };
  }

  if (session.mode === 'scaleClip') {
    const dist = Math.hypot(input.worldX - session.cx, input.worldY - session.cy);
    const scale = scaleFromCornerDrag(session.startScale, session.startDist, dist);
    if (input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'cancelClipTransform', clipId: session.clipId }],
      };
    }
    if (input.phase === 'up') {
      return {
        session: { mode: 'idle' },
        effects: [
          { type: 'clipTransformLive', clipId: session.clipId, scale },
          { type: 'commitClipTransform', clipId: session.clipId },
        ],
      };
    }
    return {
      session,
      effects: [{ type: 'clipTransformLive', clipId: session.clipId, scale }],
    };
  }

  if (session.mode === 'rotateClip') {
    const angle = angleFromCenter(session.cx, session.cy, input.worldX, input.worldY);
    const rotation = rotationFromHandleDrag(session.startRotation, session.startAngle, angle);
    if (input.phase === 'cancel') {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'cancelClipTransform', clipId: session.clipId }],
      };
    }
    if (input.phase === 'up') {
      return {
        session: { mode: 'idle' },
        effects: [
          { type: 'clipTransformLive', clipId: session.clipId, rotation },
          { type: 'commitClipTransform', clipId: session.clipId },
        ],
      };
    }
    return {
      session,
      effects: [{ type: 'clipTransformLive', clipId: session.clipId, rotation }],
    };
  }

  return { session, effects: [] };
}

function stepPencilDown(
  input: WorkspacePointerInput,
  hit: WorkspaceHit,
): { session: WorkspaceSession; effects: WorkspaceEffect[] } {
  if (isChromeTapHit(hit)) {
    return {
      session: {
        mode: 'pendingChromeTap',
        kind: 'pencil',
        hit,
        startX: input.x,
        startY: input.y,
      },
      effects: [],
    };
  }

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
        const startDist = Math.hypot(input.worldX - bounds.cx, input.worldY - bounds.cy);
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
            startAngle: angleFromCenter(bounds.cx, bounds.cy, input.worldX, input.worldY),
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
          offsetX: input.worldX - clip.x,
          offsetY: input.worldY - clip.y,
        },
        effects: [{ type: 'selectClip', clipId: hit.clipId }],
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
    if (hit.kind === 'empty' && input.selectedClipId) {
      return {
        session: { mode: 'idle' },
        effects: [{ type: 'selectClip', clipId: null }],
      };
    }
    return { session: { mode: 'idle' }, effects: [] };
  }

  if (intent.type === 'textEdit') {
    if (isTextHandleHit(hit)) {
      return {
        session: {
          mode: 'resizeText',
          kind: 'pencil',
          textId: hit.textId,
          owner: hit.owner,
          pageId: hit.pageId,
          startWorldBox: hit.worldBox,
        },
        effects: [{ type: 'selectText', textId: hit.textId }],
      };
    }
    if (isTextBodyHit(hit)) {
      const moveSession = textMoveSessionFromHit(hit);
      if (!moveSession) {
        return { session: { mode: 'idle' }, effects: [] };
      }
      return {
        session: {
          mode: 'pendingTextMove',
          kind: 'pencil',
          startX: input.x,
          startY: input.y,
          ...moveSession,
        },
        effects: [],
      };
    }
    if (isPageBodyHit(hit)) {
      return {
        session: {
          mode: 'pendingTextCreate',
          kind: 'pencil',
          pageId: hit.pageId,
          startX: input.x,
          startY: input.y,
          localX: hit.localX,
          localY: hit.localY,
        },
        effects: [],
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

  if (session.mode === 'zoomDrag') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [] };
    }
    const dy = input.y - session.lastY;
    if (dy === 0) {
      return { session, effects: [] };
    }
    const scaleBy = 2 ** (-dy / 160);
    store.fingerPositions.set(session.pointerId, { x: session.anchorX, y: session.anchorY });
    return {
      session: { ...session, lastY: input.y },
      effects: [{ type: 'pinchBy', scaleBy, midDx: 0, midDy: 0 }],
    };
  }

  if (session.mode === 'grabPage') {
    if (input.phase === 'up' || input.phase === 'cancel') {
      return { session: { mode: 'idle' }, effects: [{ type: 'endGrabPage' }] };
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
    const partner = store.sessions.get(partnerId);
    if (partner?.mode !== 'pinch' || !store.fingerPositions.get(partnerId)) {
      return {
        session: { mode: 'pan', kind: 'finger', lastX: input.x, lastY: input.y },
        effects: [],
      };
    }
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
        const tapHit = tapHitForEffects(session.hit, input);
        const effects = tapEffects(tapHit, input.selectedPageId, input.tool, input);
        return {
          session: { mode: 'idle' },
          effects,
        };
      }
      return { session: { mode: 'idle' }, effects: [] };
    }

    const dist = Math.hypot(input.x - session.startX, input.y - session.startY);
    if (dist >= PAN_SLOP) {
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
      return {
        session: { mode: 'pan', kind: 'finger', lastX: input.x, lastY: input.y },
        effects: [{ type: 'panBy', dx: input.x - session.startX, dy: input.y - session.startY }],
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

  if (input.pointerType === 'mouse' && input.desktopNav === 'pan') {
    return {
      session: { mode: 'pan', kind: 'finger', lastX: input.x, lastY: input.y },
      effects: [],
      ignored: false,
    };
  }

  if (input.pointerType === 'mouse' && input.desktopNav === 'zoom') {
    return {
      session: {
        mode: 'zoomDrag',
        kind: 'finger',
        pointerId: input.pointerId,
        lastY: input.y,
        anchorX: input.x,
        anchorY: input.y,
      },
      effects: [],
      ignored: false,
    };
  }

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
      const partnerId = session.mode === 'pinch' ? session.partnerId : null;
      store.sessions.delete(input.pointerId);
      store.fingerPositions.delete(input.pointerId);
      if (partnerId !== null) {
        demotePinchPartner(store, partnerId);
      }
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
