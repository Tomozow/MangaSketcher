import type { PointerEvent, ToolId, PointerKind } from './types';

export type PointerIntent =
  | { type: 'pan' }
  | { type: 'pinch' }
  | { type: 'pageOp' }
  | { type: 'pdfDrag' }
  | { type: 'longPressReorder' }
  | { type: 'drawInk' }
  | { type: 'eraseInk' }
  | { type: 'textEdit' }
  | { type: 'selectMarquee' }
  | { type: 'drawLasso' };

/**
 * Finger: pan, pinch, page ops, PDF drag, long-press reorder.
 * Pencil: draw, erase, text, selection rect, lasso. Stock thumbs: drag (move / take out).
 * Select tool: Pencil draws the rect; finger still pans.
 * Lasso tool: Pencil draws a freeform path; the resulting clip is a rectangle.
 */
export function resolvePointerIntent(
  tool: ToolId,
  event: Pick<PointerEvent, 'kind' | 'phase'>,
): PointerIntent {
  if (event.kind === 'finger') {
    if (event.phase === 'longpress') {
      return { type: 'longPressReorder' };
    }
    return { type: 'pan' };
  }
  // Pencil never pans or grabs pages, regardless of tool.

  switch (tool) {
    case 'pen':
      return { type: 'drawInk' };
    case 'eraser':
      return { type: 'eraseInk' };
    case 'text':
      return { type: 'textEdit' };
    case 'select':
      return { type: 'selectMarquee' };
    case 'lasso':
      return { type: 'drawLasso' };
    default: {
      const _exhaustive: never = tool;
      return _exhaustive;
    }
  }
}

export type PressureAffect = {
  size: boolean;
  opacity: boolean;
};

export function pressureAffectsOf(
  tools: {
    pressureEnabled?: boolean;
    pressureAffectsSize?: boolean;
    pressureAffectsOpacity?: boolean;
    eraserPressureAffectsSize?: boolean;
    eraserPressureAffectsOpacity?: boolean;
  },
  erase = false,
): PressureAffect {
  if (erase) {
    return {
      size: tools.eraserPressureAffectsSize ?? tools.pressureEnabled !== false,
      opacity: tools.eraserPressureAffectsOpacity === true,
    };
  }
  return {
    size: tools.pressureAffectsSize ?? tools.pressureEnabled !== false,
    opacity: tools.pressureAffectsOpacity === true,
  };
}

export function brushRadius(
  baseSize: number,
  pressure: number,
  kind: PointerEvent['kind'],
  pressureEnabled = true,
): number {
  if (kind === 'pencil' && pressureEnabled) {
    return Math.max(0.5, baseSize * Math.max(0.05, pressure));
  }
  return Math.max(0.5, baseSize);
}

export function brushOpacity(
  baseOpacity: number,
  pressure: number,
  kind: PointerEvent['kind'],
  pressureEnabled = false,
): number {
  const clamped = Math.max(0, Math.min(1, baseOpacity));
  if (kind === 'pencil' && pressureEnabled) {
    return Math.max(0.02, Math.min(1, clamped * Math.max(0.05, pressure)));
  }
  return clamped;
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

export function pdfPointerPolicy(_kind: PointerKind): { rangeSelect: boolean } {
  return { rangeSelect: true };
}

export function stockPointerPolicy(kind: PointerKind): { pan: boolean; dragPage: boolean } {
  if (kind === 'finger') {
    return { pan: true, dragPage: true };
  }
  return { pan: false, dragPage: true };
}
