import { resolvePointerIntent } from './pointers';
import type { ClipId, PageId, PointerKind, PointerPhase, Rect, TextId, ToolId } from './types';

export const LONG_PRESS_MS = 420;
export const PAN_SLOP = 12;
export const TEXT_MOVE_SLOP = 8;

export type GestureHit =
  | { kind: 'page'; pageId: PageId; localX: number; localY: number; readingIndex: number; insertIndex: number }
  | { kind: 'slot'; insertIndex: number }
  | { kind: 'clip'; clipId: ClipId }
  | { kind: 'pasteboardText'; textId: TextId }
  | { kind: 'pageText'; textId: TextId; pageId: PageId; localX: number; localY: number }
  | { kind: 'resizeHandle'; textId: TextId; localX: number; localY: number }
  | { kind: 'empty' };

export type WorkspaceGesture =
  | { mode: 'idle' }
  | { mode: 'fingerPending'; hit: GestureHit; startX: number; startY: number; startedAt: number }
  | { mode: 'pan'; lastX: number; lastY: number }
  | { mode: 'pinch'; lastDist: number }
  | { mode: 'grabPage'; pageId: PageId; fromIndex: number }
  | { mode: 'stroke'; pageId: PageId; erase: boolean }
  | { mode: 'eraseClip'; clipId: ClipId }
  | { mode: 'marquee'; pageId: PageId; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'moveClip'; clipId: ClipId }
  | { mode: 'moveText'; textId: TextId }
  | { mode: 'pendingTextMove'; textId: TextId; startX: number; startY: number }
  | { mode: 'resizeText'; textId: TextId };

export type GestureEffect =
  | { type: 'panBy'; dx: number; dy: number }
  | { type: 'pinchBy'; scaleBy: number }
  | { type: 'stampPage'; pageId: PageId; x: number; y: number; pressure: number; erase: boolean }
  | { type: 'stampClip'; clipId: ClipId; x: number; y: number; pressure: number; erase: boolean }
  | { type: 'grabPage'; pageId: PageId; fromIndex: number }
  | { type: 'marqueePreview'; pageId: PageId; rect: Rect }
  | { type: 'completeMarquee'; pageId: PageId; rect: Rect }
  | { type: 'createText'; pageId: PageId; x: number; y: number }
  | { type: 'moveClip'; clipId: ClipId; x: number; y: number }
  | { type: 'moveText'; textId: TextId; x: number; y: number }
  | { type: 'resizeText'; textId: TextId; x: number; y: number }
  | { type: 'selectText'; textId: TextId };

export function canGrabPage(kind: PointerKind, phase: PointerPhase): boolean {
  return kind === 'finger' && phase === 'longpress';
}

function isTextBodyHit(
  hit: GestureHit,
): hit is Extract<GestureHit, { kind: 'pageText' | 'pasteboardText' }> {
  return hit.kind === 'pageText' || hit.kind === 'pasteboardText';
}

function isTextHandleHit(hit: GestureHit): hit is Extract<GestureHit, { kind: 'resizeHandle' }> {
  return hit.kind === 'resizeHandle';
}

/**
 * Ink tools ignore text boxes so drawing is never stolen by move/resize.
 * Text tool prefers handle over body over page (tldraw-style exclusive hit).
 */
export function preferHitForTool(tool: ToolId, kind: PointerKind, hit: GestureHit): GestureHit {
  if (kind === 'pencil' && (tool === 'pen' || tool === 'eraser')) {
    if (hit.kind === 'pageText') {
      return {
        kind: 'page',
        pageId: hit.pageId,
        localX: hit.localX,
        localY: hit.localY,
        readingIndex: 0,
        insertIndex: 0,
      };
    }
    if (hit.kind === 'resizeHandle' || hit.kind === 'pasteboardText') {
      return { kind: 'empty' };
    }
  }
  return hit;
}

function stampFromHit(
  hit: GestureHit,
  state: WorkspaceGesture,
  input: { x: number; y: number; pressure: number; erase: boolean },
): { state: WorkspaceGesture; effects: GestureEffect[] } | null {
  if (state.mode === 'stroke') {
    const x = hit.kind === 'page' ? hit.localX : input.x;
    const y = hit.kind === 'page' ? hit.localY : input.y;
    return {
      state,
      effects: [{ type: 'stampPage', pageId: state.pageId, x, y, pressure: input.pressure, erase: state.erase }],
    };
  }
  if (hit.kind !== 'page') {
    return null;
  }
  return {
    state: { mode: 'stroke', pageId: hit.pageId, erase: input.erase },
    effects: [
      {
        type: 'stampPage',
        pageId: hit.pageId,
        x: hit.localX,
        y: hit.localY,
        pressure: input.pressure,
        erase: input.erase,
      },
    ],
  };
}

export function stepWorkspaceGesture(
  state: WorkspaceGesture,
  input: {
    kind: PointerKind;
    phase: PointerPhase | 'pinch';
    tool: ToolId;
    x: number;
    y: number;
    pressure: number;
    hit: GestureHit;
    touchCount: number;
    pinchDist?: number;
    now: number;
    selectedClipId: ClipId | null;
  },
): { state: WorkspaceGesture; effects: GestureEffect[] } {
  const hit = preferHitForTool(input.tool, input.kind, input.hit);
  const intent = resolvePointerIntent(input.tool, {
    kind: input.kind,
    phase: input.phase === 'pinch' ? 'move' : input.phase,
  });

  if (input.kind === 'finger' && input.touchCount >= 2 && input.phase !== 'up') {
    const dist = input.pinchDist ?? 1;
    if (state.mode === 'pinch') {
      const scaleBy = dist / Math.max(1, state.lastDist);
      return { state: { mode: 'pinch', lastDist: dist }, effects: [{ type: 'pinchBy', scaleBy }] };
    }
    return { state: { mode: 'pinch', lastDist: dist }, effects: [] };
  }

  if (input.phase === 'up') {
    if (state.mode === 'marquee') {
      const rect = {
        x: Math.min(state.x0, state.x1),
        y: Math.min(state.y0, state.y1),
        width: Math.abs(state.x1 - state.x0),
        height: Math.abs(state.y1 - state.y0),
      };
      return { state: { mode: 'idle' }, effects: [{ type: 'completeMarquee', pageId: state.pageId, rect }] };
    }
    return { state: { mode: 'idle' }, effects: [] };
  }

  // Locked sessions: never re-classify until pointer up (sketch-canvas exclusive capture).
  if (state.mode === 'resizeText') {
    return {
      state,
      effects: [
        { type: 'selectText', textId: state.textId },
        { type: 'resizeText', textId: state.textId, x: input.x, y: input.y },
      ],
    };
  }
  if (state.mode === 'moveText') {
    const x = hit.kind === 'pageText' ? hit.localX : input.x;
    const y = hit.kind === 'pageText' ? hit.localY : input.y;
    return {
      state,
      effects: [
        { type: 'selectText', textId: state.textId },
        { type: 'moveText', textId: state.textId, x, y },
      ],
    };
  }
  if (state.mode === 'pendingTextMove') {
    const dist = Math.hypot(input.x - state.startX, input.y - state.startY);
    if (dist < TEXT_MOVE_SLOP) {
      return { state, effects: [{ type: 'selectText', textId: state.textId }] };
    }
    const x = hit.kind === 'pageText' ? hit.localX : input.x;
    const y = hit.kind === 'pageText' ? hit.localY : input.y;
    return {
      state: { mode: 'moveText', textId: state.textId },
      effects: [
        { type: 'selectText', textId: state.textId },
        { type: 'moveText', textId: state.textId, x, y },
      ],
    };
  }
  if (state.mode === 'stroke') {
    const next = stampFromHit(hit, state, {
      x: input.x,
      y: input.y,
      pressure: input.pressure,
      erase: state.erase,
    });
    return next ?? { state, effects: [] };
  }
  if (state.mode === 'eraseClip') {
    return {
      state,
      effects: [
        {
          type: 'stampClip',
          clipId: state.clipId,
          x: input.x,
          y: input.y,
          pressure: input.pressure,
          erase: true,
        },
      ],
    };
  }
  if (state.mode === 'marquee') {
    const lx = hit.kind === 'page' ? hit.localX : input.x;
    const ly = hit.kind === 'page' ? hit.localY : input.y;
    const next = { mode: 'marquee' as const, pageId: state.pageId, x0: state.x0, y0: state.y0, x1: lx, y1: ly };
    const rect = {
      x: Math.min(next.x0, next.x1),
      y: Math.min(next.y0, next.y1),
      width: Math.abs(next.x1 - next.x0),
      height: Math.abs(next.y1 - next.y0),
    };
    return { state: next, effects: [{ type: 'marqueePreview', pageId: state.pageId, rect }] };
  }
  if (state.mode === 'moveClip') {
    return {
      state,
      effects: [{ type: 'moveClip', clipId: state.clipId, x: input.x, y: input.y }],
    };
  }
  if (state.mode === 'pan') {
    return {
      state: { mode: 'pan', lastX: input.x, lastY: input.y },
      effects: [{ type: 'panBy', dx: input.x - state.lastX, dy: input.y - state.lastY }],
    };
  }
  if (state.mode === 'grabPage') {
    return { state, effects: [] };
  }

  if (input.kind === 'pencil') {
    if (intent.type === 'drawInk' || intent.type === 'eraseInk') {
      const erase = intent.type === 'eraseInk';
      if (erase && input.selectedClipId && hit.kind === 'clip') {
        return {
          state: { mode: 'eraseClip', clipId: hit.clipId },
          effects: [
            {
              type: 'stampClip',
              clipId: hit.clipId,
              x: input.x,
              y: input.y,
              pressure: input.pressure,
              erase: true,
            },
          ],
        };
      }
      const stamped = stampFromHit(hit, state, {
        x: input.x,
        y: input.y,
        pressure: input.pressure,
        erase,
      });
      if (stamped) {
        return stamped;
      }
      return { state, effects: [] };
    }
    if (intent.type === 'selectMarquee') {
      if (hit.kind === 'clip') {
        return {
          state: { mode: 'moveClip', clipId: hit.clipId },
          effects: [{ type: 'moveClip', clipId: hit.clipId, x: input.x, y: input.y }],
        };
      }
      if (hit.kind === 'page') {
        return {
          state: { mode: 'marquee', pageId: hit.pageId, x0: hit.localX, y0: hit.localY, x1: hit.localX, y1: hit.localY },
          effects: [
            { type: 'marqueePreview', pageId: hit.pageId, rect: { x: hit.localX, y: hit.localY, width: 0, height: 0 } },
          ],
        };
      }
      return { state, effects: [] };
    }
    if (intent.type === 'textEdit') {
      if (isTextHandleHit(hit)) {
        return {
          state: { mode: 'resizeText', textId: hit.textId },
          effects: [
            { type: 'selectText', textId: hit.textId },
            { type: 'resizeText', textId: hit.textId, x: input.x, y: input.y },
          ],
        };
      }
      if (isTextBodyHit(hit)) {
        if (input.phase === 'down') {
          return {
            state: { mode: 'pendingTextMove', textId: hit.textId, startX: input.x, startY: input.y },
            effects: [{ type: 'selectText', textId: hit.textId }],
          };
        }
        return {
          state: { mode: 'moveText', textId: hit.textId },
          effects: [
            { type: 'selectText', textId: hit.textId },
            {
              type: 'moveText',
              textId: hit.textId,
              x: hit.kind === 'pageText' ? hit.localX : input.x,
              y: hit.kind === 'pageText' ? hit.localY : input.y,
            },
          ],
        };
      }
      if (input.phase === 'down' && hit.kind === 'page') {
        return {
          state: { mode: 'idle' },
          effects: [{ type: 'createText', pageId: hit.pageId, x: hit.localX, y: hit.localY }],
        };
      }
    }
    return { state, effects: [] };
  }

  // Finger: pan / pinch / long-press grab. Never move or resize text.
  if (input.phase === 'longpress' && hit.kind === 'page' && canGrabPage('finger', 'longpress')) {
    return {
      state: { mode: 'grabPage', pageId: hit.pageId, fromIndex: hit.readingIndex },
      effects: [{ type: 'grabPage', pageId: hit.pageId, fromIndex: hit.readingIndex }],
    };
  }
  if (input.phase === 'down') {
    const selectText: GestureEffect[] = isTextBodyHit(hit) ? [{ type: 'selectText', textId: hit.textId }] : [];
    return {
      state: { mode: 'fingerPending', hit, startX: input.x, startY: input.y, startedAt: input.now },
      effects: selectText,
    };
  }
  if (state.mode === 'fingerPending') {
    const dist = Math.hypot(input.x - state.startX, input.y - state.startY);
    const onText = isTextBodyHit(state.hit) || isTextHandleHit(state.hit);
    if (dist >= PAN_SLOP) {
      if (onText) {
        return { state, effects: [] };
      }
      return {
        state: { mode: 'pan', lastX: input.x, lastY: input.y },
        effects: [{ type: 'panBy', dx: input.x - state.startX, dy: input.y - state.startY }],
      };
    }
    if (input.now - state.startedAt >= LONG_PRESS_MS && state.hit.kind === 'page') {
      return {
        state: { mode: 'grabPage', pageId: state.hit.pageId, fromIndex: state.hit.readingIndex },
        effects: [{ type: 'grabPage', pageId: state.hit.pageId, fromIndex: state.hit.readingIndex }],
      };
    }
    return { state, effects: [] };
  }
  return { state, effects: [] };
}
