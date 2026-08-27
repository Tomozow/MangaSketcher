import type { PointerKind } from '../domain/types';

/** RNGH `PointerType.STYLUS`. UIKit `UITouchTypePencil` is 2 — do not mix the enums. */
const RNGH_STYLUS = 1;
const UITouchPencil = 2;

export type StylusDataLike = {
  pressure?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
};

export type NativePointerLike = {
  pointerType?: number | string;
  type?: string;
  touchType?: number | string;
  force?: number;
  pressure?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
  identifier?: number | string;
  pointerId?: number | string;
  stylusData?: StylusDataLike;
  touches?: NativePointerLike[];
  changedTouches?: NativePointerLike[];
};

const PEN_STRINGS = new Set(['pen', 'pencil', 'stylus']);
const FINGER_STRINGS = new Set(['touch', 'finger', 'direct', 'mouse', 'key']);

function firstTouch(nativeEvent: NativePointerLike): NativePointerLike {
  return nativeEvent.touches?.[0] ?? nativeEvent.changedTouches?.[0] ?? nativeEvent;
}

function asToken(value: number | string | undefined): string {
  if (value === undefined) {
    return '';
  }
  return `${value}`.toLowerCase();
}

/**
 * RNGH は `pointerType` を数値で渡す（0=指, 1=Pencil）。
 * W3C Pointer Events は `"pen"` / `"touch"`。
 * Fabric の Responder には type が載らないので、それだけに頼らない。
 */
export function pointerKindFromNative(nativeEvent: NativePointerLike): PointerKind {
  const touch = firstTouch(nativeEvent);
  const pointerType = nativeEvent.pointerType ?? touch.pointerType;

  if (pointerType === RNGH_STYLUS || PEN_STRINGS.has(asToken(pointerType))) {
    return 'pencil';
  }
  if (
    pointerType === 0 ||
    pointerType === 2 ||
    pointerType === 3 ||
    pointerType === 4 ||
    FINGER_STRINGS.has(asToken(pointerType))
  ) {
    return 'finger';
  }

  if (nativeEvent.stylusData || touch.stylusData) {
    return 'pencil';
  }

  const eventName = asToken(nativeEvent.type);
  if (PEN_STRINGS.has(eventName) || eventName.includes('pencil') || eventName.includes('stylus')) {
    return 'pencil';
  }

  const touchType = nativeEvent.touchType ?? touch.touchType;
  if (touchType === UITouchPencil || touchType === 'stylus' || touchType === 'pencil') {
    return 'pencil';
  }
  if (touchType === 0 || touchType === 'direct') {
    return 'finger';
  }

  const altitude = nativeEvent.altitudeAngle ?? touch.altitudeAngle;
  if (typeof altitude === 'number' && Number.isFinite(altitude)) {
    return 'pencil';
  }

  return 'finger';
}

export function pointerIdFromNative(nativeEvent: NativePointerLike): number {
  const touch = firstTouch(nativeEvent);
  const id = nativeEvent.pointerId ?? nativeEvent.identifier ?? touch.identifier;
  if (typeof id === 'number' && Number.isFinite(id)) {
    return id;
  }
  if (typeof id === 'string') {
    const parsed = Number(id);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function pressureFromNative(nativeEvent: NativePointerLike): number {
  const touch = firstTouch(nativeEvent);
  const value =
    nativeEvent.stylusData?.pressure ??
    touch.stylusData?.pressure ??
    nativeEvent.pressure ??
    touch.pressure ??
    nativeEvent.force ??
    touch.force;
  if (typeof value === 'number' && value > 0) {
    return Math.min(1, Math.max(0.08, value));
  }
  return 1;
}

/**
 * 同一 identifier は最初に Pencil と分かったら最後まで Pencil。
 * 途中のイベントで pointerType が欠けても stroke が指に落ちない。
 */
export function createPointerKindTracker() {
  const sticky = new Map<number, PointerKind>();
  return {
    classify(nativeEvent: NativePointerLike): PointerKind {
      const id = pointerIdFromNative(nativeEvent);
      const detected = pointerKindFromNative(nativeEvent);
      const prev = sticky.get(id);
      const kind: PointerKind = prev === 'pencil' || detected === 'pencil' ? 'pencil' : detected;
      sticky.set(id, kind);
      return kind;
    },
    release(nativeEvent: NativePointerLike): void {
      sticky.delete(pointerIdFromNative(nativeEvent));
    },
    reset(): void {
      sticky.clear();
    },
  };
}

export function workspacePointerPolicy(kind: PointerKind): {
  pan: boolean;
  grabPage: boolean;
  ink: boolean;
  marquee: boolean;
  text: boolean;
} {
  if (kind === 'finger') {
    return { pan: true, grabPage: true, ink: false, marquee: false, text: false };
  }
  return { pan: false, grabPage: false, ink: true, marquee: true, text: true };
}

export function pdfPointerPolicy(kind: PointerKind): { rangeSelect: boolean } {
  return { rangeSelect: kind === 'finger' };
}

export function stockPointerPolicy(kind: PointerKind): { pan: boolean; dragPage: boolean } {
  if (kind === 'finger') {
    return { pan: true, dragPage: true };
  }
  return { pan: false, dragPage: false };
}
