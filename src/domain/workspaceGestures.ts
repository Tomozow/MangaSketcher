import { resolvePointerIntent } from './pointers';
import type { ClipId, PageId, PointerKind, PointerPhase, Rect, TextId, ToolId } from './types';

export const LONG_PRESS_MS = 420;
export const PAN_SLOP = 12;

export type GestureHit =
  | { kind: 'page'; pageId: PageId; localX: number; localY: number; readingIndex: number; insertIndex: number }
  | { kind: 'slot'; insertIndex: number }
  | { kind: 'clip'; clipId: ClipId }
  | { kind: 'pasteboardText'; textId: TextId }
  | { kind: 'pageText'; textId: TextId; localX: number; localY: number }
  | { kind: 'resizeHandle'; textId: TextId; localX: number; localY: number }
  | { kind: 'empty' };

export type WorkspaceGesture =
  | { mode: 'idle' }
  | { mode: 'fingerPending'; hit: GestureHit; startX: number; startY: number; startedAt: number }
  | { mode: 'pan' }
  | { mode: 'pinch'; lastDist: number }
  | { mode: 'grabPage'; pageId: PageId; fromIndex: number }
  | { mode: 'stroke'; pageId: PageId; erase: boolean }
  | { mode: 'eraseClip'; clipId: ClipId }
  | { mode: 'marquee'; pageId: PageId; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'moveClip'; clipId: ClipId }
  | { mode: 'moveText'; textId: TextId }
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

  if (input.kind === 'pencil') {
    if (intent.type === 'drawInk' || intent.type === 'eraseInk') {
      const erase = intent.type === 'eraseInk';
      if (erase && input.selectedClipId && (state.mode === 'eraseClip' || input.hit.kind === 'clip')) {
        const clipId = state.mode === 'eraseClip' ? state.clipId : input.hit.kind === 'clip' ? input.hit.clipId : input.selectedClipId;
        if (input.phase === 'up') {
          return { state: { mode: 'idle' }, effects: [] };
        }
        return {
          state: { mode: 'eraseClip', clipId },
          effects:
            input.hit.kind === 'clip'
              ? [{ type: 'stampClip', clipId, x: input.x, y: input.y, pressure: input.pressure, erase: true }]
              : [{ type: 'stampClip', clipId, x: input.x, y: input.y, pressure: input.pressure, erase: true }],
        };
      }
      if (input.hit.kind === 'page' || state.mode === 'stroke') {
        const pageId = state.mode === 'stroke' ? state.pageId : input.hit.kind === 'page' ? input.hit.pageId : null;
        if (!pageId) {
          return { state: { mode: 'idle' }, effects: [] };
        }
        if (input.phase === 'up') {
          return { state: { mode: 'idle' }, effects: [] };
        }
        const localX = input.hit.kind === 'page' ? input.hit.localX : input.x;
        const localY = input.hit.kind === 'page' ? input.hit.localY : input.y;
        return {
          state: { mode: 'stroke', pageId, erase },
          effects: [{ type: 'stampPage', pageId, x: localX, y: localY, pressure: input.pressure, erase }],
        };
      }
    }
    if (intent.type === 'selectMarquee') {
      if (input.hit.kind === 'clip' || state.mode === 'moveClip') {
        const clipId = state.mode === 'moveClip' ? state.clipId : input.hit.kind === 'clip' ? input.hit.clipId : null;
        if (!clipId) {
          return { state, effects: [] };
        }
        if (input.phase === 'up') {
          return { state: { mode: 'idle' }, effects: [] };
        }
        return {
          state: { mode: 'moveClip', clipId },
          effects: [{ type: 'moveClip', clipId, x: input.x, y: input.y }],
        };
      }
      if (input.hit.kind === 'page' || state.mode === 'marquee') {
        const pageId = state.mode === 'marquee' ? state.pageId : input.hit.kind === 'page' ? input.hit.pageId : null;
        if (!pageId) {
          return { state: { mode: 'idle' }, effects: [] };
        }
        const lx = input.hit.kind === 'page' ? input.hit.localX : input.x;
        const ly = input.hit.kind === 'page' ? input.hit.localY : input.y;
        if (input.phase === 'down' || state.mode !== 'marquee') {
          return {
            state: { mode: 'marquee', pageId, x0: lx, y0: ly, x1: lx, y1: ly },
            effects: [{ type: 'marqueePreview', pageId, rect: { x: lx, y: ly, width: 0, height: 0 } }],
          };
        }
        const next = { mode: 'marquee' as const, pageId, x0: state.x0, y0: state.y0, x1: lx, y1: ly };
        const rect = {
          x: Math.min(next.x0, next.x1),
          y: Math.min(next.y0, next.y1),
          width: Math.abs(next.x1 - next.x0),
          height: Math.abs(next.y1 - next.y0),
        };
        if (input.phase === 'up') {
          return { state: { mode: 'idle' }, effects: [{ type: 'completeMarquee', pageId, rect }] };
        }
        return { state: next, effects: [{ type: 'marqueePreview', pageId, rect }] };
      }
    }
    if (intent.type === 'textEdit') {
      if (input.phase === 'up') {
        return { state: { mode: 'idle' }, effects: [] };
      }
      if (input.hit.kind === 'resizeHandle' || state.mode === 'resizeText') {
        const textId =
          state.mode === 'resizeText' ? state.textId : input.hit.kind === 'resizeHandle' ? input.hit.textId : null;
        if (!textId) {
          return { state: { mode: 'idle' }, effects: [] };
        }
        return {
          state: { mode: 'resizeText', textId },
          effects: [
            { type: 'selectText', textId },
            { type: 'resizeText', textId, x: input.x, y: input.y },
          ],
        };
      }
      if (
        input.hit.kind === 'pageText' ||
        input.hit.kind === 'pasteboardText' ||
        state.mode === 'moveText'
      ) {
        const textId =
          state.mode === 'moveText'
            ? state.textId
            : input.hit.kind === 'pageText' || input.hit.kind === 'pasteboardText'
              ? input.hit.textId
              : null;
        if (!textId) {
          return { state: { mode: 'idle' }, effects: [] };
        }
        const x = input.hit.kind === 'pageText' ? input.hit.localX : input.x;
        const y = input.hit.kind === 'pageText' ? input.hit.localY : input.y;
        return {
          state: { mode: 'moveText', textId },
          effects: [
            { type: 'selectText', textId },
            { type: 'moveText', textId, x, y },
          ],
        };
      }
      if (input.phase === 'down' && input.hit.kind === 'page') {
        return {
          state: { mode: 'idle' },
          effects: [{ type: 'createText', pageId: input.hit.pageId, x: input.hit.localX, y: input.hit.localY }],
        };
      }
    }
    if (input.phase === 'up') {
      return { state: { mode: 'idle' }, effects: [] };
    }
    return { state, effects: [] };
  }

  // Finger
  if (input.phase === 'up') {
    return { state: { mode: 'idle' }, effects: [] };
  }
  if (state.mode === 'grabPage') {
    return { state, effects: [] };
  }
  if (input.phase === 'longpress' && input.hit.kind === 'page' && canGrabPage('finger', 'longpress')) {
    return {
      state: { mode: 'grabPage', pageId: input.hit.pageId, fromIndex: input.hit.readingIndex },
      effects: [{ type: 'grabPage', pageId: input.hit.pageId, fromIndex: input.hit.readingIndex }],
    };
  }
  if (input.phase === 'down') {
    const selectText: GestureEffect[] =
      input.hit.kind === 'pageText' || input.hit.kind === 'pasteboardText'
        ? [{ type: 'selectText', textId: input.hit.textId }]
        : [];
    return {
      state: { mode: 'fingerPending', hit: input.hit, startX: input.x, startY: input.y, startedAt: input.now },
      effects: selectText,
    };
  }
  if (state.mode === 'fingerPending') {
    const dist = Math.hypot(input.x - state.startX, input.y - state.startY);
    const onTextBox =
      state.hit.kind === 'pageText' ||
      state.hit.kind === 'pasteboardText' ||
      state.hit.kind === 'resizeHandle';
    if (dist >= PAN_SLOP) {
      if (onTextBox) {
        return { state, effects: [] };
      }
      return {
        state: { mode: 'pan' },
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
  if (state.mode === 'pan' || intent.type === 'pan') {
    return { state: { mode: 'pan' }, effects: [{ type: 'panBy', dx: 0, dy: 0 }] };
  }
  return { state, effects: [] };
}
