import {
  createPointerKindTracker,
  createPressureState,
  isPencilHover,
  markPointerDown,
  markPointerUp,
  pointerIdFromWeb,
  pointerKindForWorkspace,
  pressureFromWeb,
} from '../../input/pointerEvents';
import { bindDesktopNavKeys, desktopNavMode } from '../../input/desktopNavKeys';
import type { ClipId, PageId, TextId, ToolId } from '../../domain/types';
import { screenToWorld } from '../../domain/stripGeometry';
import { stepWorkspacePointer } from './workspaceFsm';
import type { WorkspaceEffect, WorkspaceGestureStore, WorkspaceHit, WorkspaceSession } from './types';
import { createWorkspaceGestureStore } from './types';
import { PAGE_TEXT_CHROME_ATTR, PAGE_DELETE_CHROME_ATTR } from './pageTextDom';

export type PointerTarget = 'workspace' | 'pdf' | 'stock' | 'splitter';

export type WorkspacePointerContext = {
  tool: ToolId;
  selectedPageId: PageId | null;
  selectedClipId: ClipId | null;
  selectedTextId?: TextId | null;
  panX: number;
  panY: number;
  zoom: number;
  rasterWidth: number;
  rasterHeight: number;
  getClipMeta: (clipId: ClipId) => import('../../domain/types').ClipMeta | undefined;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
  resolveHit: (clientX: number, clientY: number, surfaceRect?: DOMRectReadOnly) => WorkspaceHit;
  resolveDropHit?: (clientX: number, clientY: number, surfaceRect?: DOMRectReadOnly) => WorkspaceHit;
  mapInkToPage?: (pageId: PageId, clientX: number, clientY: number) => { x: number; y: number } | null;
  mapPageDomLocal?: (pageId: PageId, clientX: number, clientY: number) => { x: number; y: number } | null;
  mapWorldToPage?: (pageId: PageId, worldX: number, worldY: number) => { x: number; y: number } | null;
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

function isTextChromeTarget(event: PointerEvent): boolean {
  const el = event.target;
  return (
    el instanceof Element &&
    (el.closest(`[${PAGE_TEXT_CHROME_ATTR}]`) !== null ||
      el.closest(`[${PAGE_DELETE_CHROME_ATTR}]`) !== null)
  );
}

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

function lockedInkHit(session: WorkspaceSession): WorkspaceHit | null {
  if (session.mode === 'penOverlay') {
    return {
      kind: 'page',
      pageId: session.pageId,
      localX: session.lastX,
      localY: session.lastY,
      readingIndex: 0,
      insertIndex: 0,
    };
  }
  if (session.mode === 'eraseDirect') {
    return {
      kind: 'page',
      pageId: session.pageId,
      localX: 0,
      localY: 0,
      readingIndex: 0,
      insertIndex: 0,
    };
  }
  return null;
}

function mergeLiveInkEffects(effects: WorkspaceEffect[]): WorkspaceEffect[] {
  const merged: WorkspaceEffect[] = [];
  for (const effect of effects) {
    const last = merged[merged.length - 1];
    if (
      effect.type === 'penOverlayMove' &&
      last?.type === 'penOverlayMove' &&
      last.pageId === effect.pageId
    ) {
      last.points.push(...effect.points);
      continue;
    }
    merged.push(effect);
  }
  return merged;
}

export function createWorkspacePointerPipeline(ctx: WorkspacePointerContext): WorkspacePointerPipeline {
  const store = createWorkspaceGestureStore();
  const kindTracker = createPointerKindTracker();
  const pressureById = new Map<number, ReturnType<typeof createPressureState>>();
  const now = ctx.now ?? (() => Date.now());

  const bind = (element: HTMLElement, target: PointerTarget) => {
    element.style.touchAction = 'none';
    const unbindDesktopNav = target === 'workspace' ? bindDesktopNavKeys() : () => {};

    const dispatch = (event: PointerEvent, phase: 'down' | 'move' | 'up' | 'cancel') => {
      const pointerId = pointerIdFromWeb(event);
      const nav = event.pointerType === 'mouse' ? desktopNavMode() : 'none';
      const kind =
        event.pointerType === 'mouse'
          ? pointerKindForWorkspace(event, phase, nav)
          : kindTracker.classify(event);
      const prevSession = store.sessions.get(pointerId);
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

      const lockedHit = prevSession ? lockedInkHit(prevSession) : null;
      const tailMoves =
        (phase === 'up' || phase === 'cancel') && lockedHit
          ? collectCoalesced(event).filter((pe) => pe !== event)
          : [];
      const events = phase === 'move' ? collectCoalesced(event) : [event];
      const batch: WorkspaceEffect[] = [];
      const surfaceRect = lockedHit ? undefined : element.getBoundingClientRect();

      const stepPe = (pe: PointerEvent, pePhase: 'down' | 'move' | 'up' | 'cancel') => {
        const hit =
          lockedHit ??
          ctx.resolveHit(pe.clientX, pe.clientY, surfaceRect ?? element.getBoundingClientRect());
        const dropHit = lockedHit
          ? hit
          : (ctx.resolveDropHit?.(pe.clientX, pe.clientY, surfaceRect ?? element.getBoundingClientRect()) ?? hit);
        const rect = surfaceRect ?? element.getBoundingClientRect();
        const localX = pe.clientX - rect.left;
        const localY = pe.clientY - rect.top;
        const { x: worldX, y: worldY } = screenToWorld(localX, localY, ctx.panX, ctx.panY, ctx.zoom);
        const { effects } = stepWorkspacePointer(store, {
          pointerId,
          kind,
          phase: pePhase,
          tool: ctx.tool,
          x: pe.clientX,
          y: pe.clientY,
          worldX,
          worldY,
          pressure: pressureFromWeb(pe, pressureState),
          hit,
          dropHit,
          now: now(),
          isPrimary: pe.isPrimary,
          selectedPageId: ctx.selectedPageId,
          selectedClipId: ctx.selectedClipId,
          selectedTextId: ctx.selectedTextId,
          rasterWidth: ctx.rasterWidth,
          rasterHeight: ctx.rasterHeight,
          getClipMeta: ctx.getClipMeta,
          getClipRasterSize: ctx.getClipRasterSize,
          mapInkToPage: ctx.mapInkToPage,
          mapPageDomLocal: ctx.mapPageDomLocal,
          mapWorldToPage: ctx.mapWorldToPage,
          pointerType: pe.pointerType,
          desktopNav: pe.pointerType === 'mouse' ? nav : 'none',
        });
        batch.push(...effects);
      };

      for (const pe of tailMoves) {
        stepPe(pe, 'move');
      }
      for (const pe of events) {
        stepPe(pe, phase);
      }
      if (batch.length > 0) {
        ctx.onEffects(mergeLiveInkEffects(batch));
      }

      if (phase === 'up' || phase === 'cancel') {
        markPointerUp(pressureState);
        pressureById.delete(pointerId);
        kindTracker.release(event);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (target === 'workspace' && isTextChromeTarget(event)) {
        return;
      }
      if (event.pointerType === 'mouse') {
        const nav = desktopNavMode();
        if (nav === 'pan' || nav === 'zoom' || (nav === 'none' && event.button === 0)) {
          event.preventDefault();
        }
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
      unbindDesktopNav();
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
export { resolveWorkspaceHit, resolveWorkspaceDropTarget, frameForPage, inkLocalOnPage } from './resolveHit';
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
