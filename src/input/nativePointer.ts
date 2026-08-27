import type { PointerKind } from '../domain/types';

export type NativePointerLike = {
  pointerType?: string;
  type?: string;
  touchType?: number | string;
  force?: number;
  pressure?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
  identifier?: number | string;
  pointerId?: number | string;
  touches?: NativePointerLike[];
  changedTouches?: NativePointerLike[];
};

const PEN_TOKENS = new Set(['pen', 'pencil', 'stylus', '1']);
const FINGER_TOKENS = new Set(['touch', 'finger', 'direct', 'mouse', '0']);

function firstTouch(nativeEvent: NativePointerLike): NativePointerLike {
  return nativeEvent.touches?.[0] ?? nativeEvent.changedTouches?.[0] ?? nativeEvent;
}

function tokenOf(nativeEvent: NativePointerLike): string {
  const touch = firstTouch(nativeEvent);
  return `${nativeEvent.pointerType ?? touch.pointerType ?? nativeEvent.touchType ?? touch.touchType ?? ''}`.toLowerCase();
}

/**
 * iPad: pointerType / touchType を優先。force だけでは判定しない
 * （弱い Pencil が指になり、3D Touch のない iPad では無意味なため）。
 * altitude/azimuth は Pencil の UITouch にだけ載ることが多い。
 */
export function pointerKindFromNative(nativeEvent: NativePointerLike): PointerKind {
  const token = tokenOf(nativeEvent);
  if (PEN_TOKENS.has(token) || token.includes('pen') || token.includes('stylus')) {
    return 'pencil';
  }
  if (FINGER_TOKENS.has(token) || token === 'direct' || token === 'finger') {
    return 'finger';
  }
  const eventName = `${nativeEvent.type ?? ''}`.toLowerCase();
  if (PEN_TOKENS.has(eventName) || eventName.includes('pencil') || eventName.includes('stylus')) {
    return 'pencil';
  }
  const touch = firstTouch(nativeEvent);
  const touchType = nativeEvent.touchType ?? touch.touchType;
  if (touchType === 1 || touchType === 'stylus') {
    return 'pencil';
  }
  if (touchType === 0 || touchType === 'direct') {
    return 'finger';
  }
  const altitude = nativeEvent.altitudeAngle ?? touch.altitudeAngle;
  const azimuth = nativeEvent.azimuthAngle ?? touch.azimuthAngle;
  if (typeof altitude === 'number' && altitude > 0.02) {
    return 'pencil';
  }
  if (typeof azimuth === 'number' && azimuth !== 0) {
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
  const value = nativeEvent.pressure ?? touch.pressure ?? nativeEvent.force ?? touch.force;
  if (typeof value === 'number' && value > 0) {
    return Math.min(1, Math.max(0.08, value));
  }
  return 1;
}

/**
 * 同一 identifier は最初に Pencil と分かったら最後まで Pencil。
 * responder が pointerType を落としても、onPointerDown の seed が効く。
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
