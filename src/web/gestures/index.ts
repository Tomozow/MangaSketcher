import {
  createPointerKindTracker,
  createPressureState,
  isPencilHover,
  markPointerDown,
  markPointerUp,
  pointerIdFromWeb,
  pressureFromWeb,
} from '../../input/pointerEvents';
import type { ClipId, PageId, ToolId } from '../../domain/types';
import { stepWorkspacePointer } from './workspaceFsm';
import type { WorkspaceEffect, WorkspaceGestureStore, WorkspaceHit } from './types';
import { createWorkspaceGestureStore } from './types';

export type PointerTarget = 'workspace' | 'pdf' | 'stock' | 'splitter';

export type WorkspacePointerContext = {
  tool: ToolId;
  selectedPageId: PageId | null;
  selectedClipId: ClipId | null;
  rasterWidth: number;
  rasterHeight: number;
  getClipMeta: (clipId: ClipId) => import('../../domain/types').ClipMeta | undefined;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
  resolveHit: (clientX: number, clientY: number) => WorkspaceHit;
  onEffects: (effects: WorkspaceEffect[]) => void;
  now?: () => number;
};

export type WorkspacePointerPipeline = {
  store: WorkspaceGestureStore;
  kindTracker: ReturnType<typeof createPointerKindTracker>;
  pressureById: Map<number, ReturnType<typeof createPressureState>>;
  bind: (element: HTMLElement, target: PointerTarget) => () => void;
  reset: () => void;
};

function shouldPreventDefault(target: PointerTarget): boolean {
  return target === 'workspace' || target === 'pdf' || target === 'stock' || target === 'splitter';
}

function collectCoalesced(event: PointerEvent): PointerEvent[] {
  if (typeof event.getCoalescedEvents === 'function') {
    const coalesced = event.getCoalescedEvents();
    if (coalesced.length > 0) {
      return coalesced;
    }
  }
  return [event];
}

export function createWorkspacePointerPipeline(ctx: WorkspacePointerContext): WorkspacePointerPipeline {
  const store = createWorkspaceGestureStore();
  const kindTracker = createPointerKindTracker();
  const pressureById = new Map<number, ReturnType<typeof createPressureState>>();
  const now = ctx.now ?? (() => Date.now());

  const dispatch = (event: PointerEvent, phase: 'down' | 'move' | 'up' | 'cancel') => {
    const pointerId = pointerIdFromWeb(event);
    const kind = kindTracker.classify(event);
    if (kind === 'pencil' && phase === 'move' && isPencilHover(event, kind)) {
      return;
    }

    let pressureState = pressureById.get(pointerId);
    if (!pressureState) {
      pressureState = createPressureState();
      pressureById.set(pointerId, pressureState);
    }
    if (phase === 'down') {
      markPointerDown(pressureState);
    }

    const events = phase === 'move' ? collectCoalesced(event) : [event];
    for (const pe of events) {
      const hit = ctx.resolveHit(pe.clientX, pe.clientY);
      const { effects } = stepWorkspacePointer(store, {
        pointerId,
        kind,
        phase,
        tool: ctx.tool,
        x: pe.clientX,
        y: pe.clientY,
        pressure: pressureFromWeb(pe, pressureState),
        hit,
        now: now(),
        isPrimary: pe.isPrimary,
        selectedPageId: ctx.selectedPageId,
        selectedClipId: ctx.selectedClipId,
        rasterWidth: ctx.rasterWidth,
        rasterHeight: ctx.rasterHeight,
        getClipMeta: ctx.getClipMeta,
        getClipRasterSize: ctx.getClipRasterSize,
      });
      if (effects.length > 0) {
        ctx.onEffects(effects);
      }
    }

    if (phase === 'up' || phase === 'cancel') {
      markPointerUp(pressureState);
      pressureById.delete(pointerId);
      kindTracker.release(event);
    }
  };

  const bind = (element: HTMLElement, target: PointerTarget) => {
    element.style.touchAction = 'none';

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && kindTracker.classify(event) === 'finger') {
        // mouse is finger but must not ink; workspace pan could be added later
      }
      if (shouldPreventDefault(target) && (event.pointerType === 'pen' || event.pointerType === 'touch')) {
        event.preventDefault();
      }
      if (!event.isPrimary && event.pointerType === 'touch') {
        const fingers = [...store.sessions.values()].filter(
          (s) => s.mode !== 'idle' && 'kind' in s && s.kind === 'finger',
        ).length;
        if (fingers >= 2) {
          return;
        }
      }
      element.setPointerCapture(event.pointerId);
      dispatch(event, 'down');
    };

    const onPointerMove = (event: PointerEvent) => {
      if (shouldPreventDefault(target) && (event.pointerType === 'pen' || event.pointerType === 'touch')) {
        event.preventDefault();
      }
      dispatch(event, 'move');
    };

    const onPointerUp = (event: PointerEvent) => {
      if (shouldPreventDefault(target) && (event.pointerType === 'pen' || event.pointerType === 'touch')) {
        event.preventDefault();
      }
      dispatch(event, 'up');
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      dispatch(event, 'cancel');
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };

    element.addEventListener('pointerdown', onPointerDown, { passive: false });
    element.addEventListener('pointermove', onPointerMove, { passive: false });
    element.addEventListener('pointerup', onPointerUp, { passive: false });
    element.addEventListener('pointercancel', onPointerCancel, { passive: false });

    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
    };
  };

  const reset = () => {
    store.sessions.clear();
    store.fingerPositions.clear();
    kindTracker.reset();
    pressureById.clear();
  };

  return { store, kindTracker, pressureById, bind, reset };
}

export { WORKSPACE_TOUCH_ACTION, createWorkspaceGestureStore } from './types';
export { stepWorkspacePointer, countActiveTouches, getWorkspaceSession, reorderTargetIndex } from './workspaceFsm';
export { resolveWorkspaceHit, frameForPage } from './resolveHit';
export type { ResolveWorkspaceHitInput } from './resolveHit';
export { reduceWorkspaceEffects } from './workspaceEffects';
export type { WorkspaceEffectBatch } from './workspaceEffects';
export type {
  WorkspaceEffect,
  WorkspaceGestureStore,
  WorkspaceHit,
  WorkspaceSession,
  WorkspaceSessionMode,
} from './types';
