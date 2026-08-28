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
import type { ClipId, PageId, ToolId } from '../../domain/types';
import { screenToWorld } from '../../domain/stripGeometry';
import { stepWorkspacePointer } from './workspaceFsm';
import type { WorkspaceEffect, WorkspaceGestureStore, WorkspaceHit } from './types';
import { createWorkspaceGestureStore } from './types';
import { PAGE_TEXT_DELETE_ATTR, PAGE_TEXT_ID_ATTR, PAGE_TEXT_WRAP_ATTR } from './pageTextDom';

export type PointerTarget = 'workspace' | 'pdf' | 'stock' | 'splitter';

export type WorkspacePointerContext = {
  tool: ToolId;
  selectedPageId: PageId | null;
  selectedClipId: ClipId | null;
  panX: number;
  panY: number;
  zoom: number;
  rasterWidth: number;
  rasterHeight: number;
  getClipMeta: (clipId: ClipId) => import('../../domain/types').ClipMeta | undefined;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
  resolveHit: (clientX: number, clientY: number) => WorkspaceHit;
  mapInkToPage?: (pageId: PageId, clientX: number, clientY: number) => { x: number; y: number } | null;
  mapPageDomLocal?: (pageId: PageId, clientX: number, clientY: number) => { x: number; y: number } | null;
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

function isTextDeleteTarget(event: PointerEvent): boolean {
  const el = event.target;
  return el instanceof Element && el.closest(`[${PAGE_TEXT_DELETE_ATTR}]`) !== null;
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
      const batch: WorkspaceEffect[] = [];
      const surfaceRect = element.getBoundingClientRect();
      for (const pe of events) {
        const hit = ctx.resolveHit(pe.clientX, pe.clientY);
        const localX = pe.clientX - surfaceRect.left;
        const localY = pe.clientY - surfaceRect.top;
        const { x: worldX, y: worldY } = screenToWorld(localX, localY, ctx.panX, ctx.panY, ctx.zoom);
        const { effects } = stepWorkspacePointer(store, {
          pointerId,
          kind,
          phase,
          tool: ctx.tool,
          x: pe.clientX,
          y: pe.clientY,
          worldX,
          worldY,
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
          mapInkToPage: ctx.mapInkToPage,
          mapPageDomLocal: ctx.mapPageDomLocal,
          pointerType: pe.pointerType,
          desktopNav: pe.pointerType === 'mouse' ? nav : 'none',
        });
        batch.push(...effects);
        if ((phase === 'down' || phase === 'up') && target === 'workspace') {
          const wraps = Array.from(element.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_WRAP_ATTR}]`));
          const nearest = wraps.slice(0, 6).map((wrap) => {
            const r = wrap.getBoundingClientRect();
            const cx = pe.clientX;
            const cy = pe.clientY;
            const inside = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
            return {
              id: wrap.getAttribute(PAGE_TEXT_ID_ATTR),
              w: Math.round(r.width),
              h: Math.round(r.height),
              l: Math.round(r.left),
              t: Math.round(r.top),
              r: Math.round(r.right),
              b: Math.round(r.bottom),
              inside,
            };
          });
          // #region agent log
          fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'516081',runId:'post-fix',hypothesisId:'A,B,C,D',location:'gestures/index.ts:dispatch',message:'workspace pointer',data:{phase,pointerType:pe.pointerType,kind,tool:ctx.tool,hitKind:hit.kind,textId:'textId' in hit?hit.textId:undefined,localX:'localX' in hit?hit.localX:undefined,localY:'localY' in hit?hit.localY:undefined,effectTypes:effects.map((e)=>e.type),isPrimary:pe.isPrimary,clientX:pe.clientX,clientY:pe.clientY,wrapCount:wraps.length,nearest},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
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
      if (target === 'workspace' && isTextDeleteTarget(event)) {
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
export { resolveWorkspaceHit, frameForPage, inkLocalOnPage } from './resolveHit';
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
