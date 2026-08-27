import type { PointerEvent, ToolId } from './types';

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

export function brushRadius(baseSize: number, pressure: number, kind: PointerEvent['kind']): number {
  if (kind === 'pencil') {
    return Math.max(0.5, baseSize * Math.max(0.05, pressure));
  }
  return baseSize;
}
