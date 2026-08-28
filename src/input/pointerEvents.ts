import type { PointerKind } from '../domain/types';

export type WebPointerLike = Pick<
  PointerEvent,
  'pointerId' | 'pointerType' | 'pressure' | 'buttons'
>;

export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';

export type WorkspaceNavMode = 'none' | 'pan' | 'zoom';

/** W3C Pointer Events → app PointerKind. Mouse defaults to finger (pan/scroll). */
export function pointerKindFromWeb(event: Pick<PointerEvent, 'pointerType'>): PointerKind {
  switch (event.pointerType) {
    case 'pen':
      return 'pencil';
    case 'touch':
    case 'mouse':
      return 'finger';
    default:
      return 'finger';
  }
}

/**
 * Workspace pointer kind: mouse left button uses the active tool (pencil);
 * Space / Ctrl+Space keeps finger (pan / zoom).
 */
export function pointerKindForWorkspace(
  event: Pick<PointerEvent, 'pointerType' | 'buttons' | 'button'>,
  phase: PointerPhase,
  nav: WorkspaceNavMode,
): PointerKind {
  if (event.pointerType === 'mouse') {
    if (nav === 'pan' || nav === 'zoom') {
      return 'finger';
    }
    if (phase === 'up' || phase === 'cancel') {
      return 'pencil';
    }
    if (phase === 'down') {
      return event.button === 0 ? 'pencil' : 'finger';
    }
    return (event.buttons & 1) !== 0 ? 'pencil' : 'finger';
  }
  return pointerKindFromWeb(event);
}

export function pointerIdFromWeb(event: Pick<PointerEvent, 'pointerId'>): number {
  return event.pointerId;
}

export type PressureState = {
  /** pointerdown seen for this pointerId */
  contacting: boolean;
  lastPressure: number;
};

export function createPressureState(): PressureState {
  return { contacting: false, lastPressure: 0.5 };
}

/**
 * §3.5 pressure rules:
 * - While contacting (buttons > 0 and down seen), pressure === 0 → 0.5
 * - Mid-stroke 0 keeps last pressure (no reset to 0.5)
 * - Values > 1 clamp to 1
 */
export function pressureFromWeb(
  event: WebPointerLike,
  state: PressureState,
): number {
  if (!state.contacting || event.buttons === 0) {
    return state.lastPressure;
  }
  const raw = event.pressure;
  if (raw === 0) {
    return state.lastPressure;
  }
  const value = Math.min(1, Math.max(0, raw));
  state.lastPressure = value;
  return value;
}

export function markPointerDown(state: PressureState): void {
  state.contacting = true;
}

export function markPointerUp(state: PressureState): void {
  state.contacting = false;
}

/**
 * pointerId sticky from down to up/cancel. First classification wins — no pencil upgrade.
 */
export function createPointerKindTracker() {
  const sticky = new Map<number, PointerKind>();
  return {
    classify(event: Pick<PointerEvent, 'pointerId' | 'pointerType'>): PointerKind {
      const id = pointerIdFromWeb(event);
      const prev = sticky.get(id);
      if (prev !== undefined) {
        return prev;
      }
      const kind = pointerKindFromWeb(event);
      sticky.set(id, kind);
      return kind;
    },
    release(event: Pick<PointerEvent, 'pointerId'>): void {
      sticky.delete(pointerIdFromWeb(event));
    },
    reset(): void {
      sticky.clear();
    },
  };
}

/** True when Pencil hover should be ignored (buttons === 0 move). */
export function isPencilHover(event: WebPointerLike, kind: PointerKind): boolean {
  return kind === 'pencil' && event.buttons === 0;
}
