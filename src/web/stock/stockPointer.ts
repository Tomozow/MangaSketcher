import {
  createPointerKindTracker,
  isPencilHover,
  markPointerDown,
  markPointerUp,
  pointerIdFromWeb,
  pointerKindForWorkspace,
  pressureFromWeb,
  createPressureState,
} from '../../input/pointerEvents';
import { bindDesktopNavKeys, desktopNavForPointer, isDesktopMousePointer } from '../../input/desktopNavKeys';
import type { PageId } from '../../domain/types';
import { getStockDragPageId, stepStockPointer } from './stockFsm';
import type { StockGestureStore, StockHit } from './types';
import { createStockGestureStore } from './types';

export type StockPointerContext = {
  layout: 'free' | 'grid';
  resolveHit: (clientX: number, clientY: number) => StockHit;
  onEffects: (effects: ReturnType<typeof stepStockPointer>['effects']) => void;
  now?: () => number;
};

export type StockPointerPipeline = {
  store: StockGestureStore;
  bind: (element: HTMLElement) => () => void;
  reset: () => void;
};

export function createStockPointerPipeline(ctx: StockPointerContext): StockPointerPipeline {
  const store = createStockGestureStore();
  const kindTracker = createPointerKindTracker();
  const pressureById = new Map<number, ReturnType<typeof createPressureState>>();
  const now = ctx.now ?? (() => Date.now());

  const dispatch = (event: PointerEvent, phase: 'down' | 'move' | 'up' | 'cancel') => {
    const pointerId = pointerIdFromWeb(event);
    const nav = desktopNavForPointer(event, phase);
    const prevSession = store.sessions.get(pointerId);
    let kind =
      isDesktopMousePointer(event.pointerType)
        ? pointerKindForWorkspace(event, phase, nav)
        : kindTracker.classify(event);
    if (
      isDesktopMousePointer(event.pointerType) &&
      prevSession &&
      prevSession.mode !== 'idle' &&
      'kind' in prevSession &&
      (phase === 'move' || phase === 'up' || phase === 'cancel')
    ) {
      kind = prevSession.kind;
    }
    if (kind === 'pencil' && phase === 'move' && isPencilHover(event, kind)) {
      return;
    }
    if (
      isDesktopMousePointer(event.pointerType) &&
      phase === 'move' &&
      event.buttons === 0 &&
      prevSession &&
      prevSession.mode !== 'idle'
    ) {
      dispatch(event, 'up');
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

    const hit = ctx.resolveHit(event.clientX, event.clientY);
    const { effects } = stepStockPointer(store, {
      pointerId,
      kind,
      phase,
      x: event.clientX,
      y: event.clientY,
      hit,
      now: now(),
      isPrimary: event.isPrimary || nav === 'pan' || nav === 'zoom',
      layout: ctx.layout,
      pointerType: event.pointerType,
      desktopNav: nav,
    });
    pressureFromWeb(event, pressureState);

    if (effects.length > 0) {
      ctx.onEffects(effects);
    }

    if (phase === 'up' || phase === 'cancel') {
      markPointerUp(pressureState);
      pressureById.delete(pointerId);
      kindTracker.release(event);
    }
  };

  const bind = (element: HTMLElement) => {
    element.style.touchAction = 'none';
    const unbindDesktopNav = bindDesktopNavKeys();

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-page-delete-chrome]')) {
        return;
      }
      const nav = desktopNavForPointer(event, 'down');
      if (
        event.pointerType === 'pen' ||
        event.pointerType === 'touch' ||
        nav !== 'none' ||
        (isDesktopMousePointer(event.pointerType) && (event.button === 0 || event.button === 2))
      ) {
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
      if (
        event.pointerType === 'pen' ||
        event.pointerType === 'touch' ||
        (isDesktopMousePointer(event.pointerType) && event.buttons !== 0)
      ) {
        event.preventDefault();
      }
      dispatch(event, 'move');
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'pen' || event.pointerType === 'touch') {
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

  return { store, bind, reset };
}

export { getStockDragPageId };
export type { PageId };