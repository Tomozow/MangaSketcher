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
  | { type: 'selectMarquee' };

/**
 * Finger: pan, pinch, page ops, PDF drag, long-press reorder.
 * Pencil: draw, erase, text, selection rect.
 * Select tool: Pencil draws the rect; finger still pans.
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
    default: {
      const _exhaustive: never = tool;
      return _exhaustive;
    }
  }
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
  return { pan: false, dragPage: false };
}
