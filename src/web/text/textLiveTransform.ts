import type { PageId, Rect } from '@/src/domain/types';

/** Ephemeral text box origin during drag; not in history until commit. */
export type TextLiveTransform = {
  x: number;
  y: number;
  /** When dragging across pages, preview on this page frame. */
  pageId?: PageId;
};

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/** Ensure raster box fields are safe for layout math. */
export function sanitizeTextBox(box: Rect): Rect {
  return {
    x: finiteOr(box.x, 0),
    y: finiteOr(box.y, 0),
    width: Math.max(4, finiteOr(box.width, 4)),
    height: Math.max(4, finiteOr(box.height, 4)),
  };
}

export function effectiveTextBox(box: Rect, live?: TextLiveTransform | null): Rect {
  const safe = sanitizeTextBox(box);
  if (!live || !Number.isFinite(live.x) || !Number.isFinite(live.y)) {
    return safe;
  }
  return { ...safe, x: live.x, y: live.y };
}

export function mergeTextLive(
  box: Rect,
  live: TextLiveTransform | undefined,
  patch: Partial<TextLiveTransform>,
): TextLiveTransform {
  const safe = sanitizeTextBox(box);
  const base = live ?? { x: safe.x, y: safe.y };
  return {
    x: finiteOr(patch.x, base.x),
    y: finiteOr(patch.y, base.y),
    pageId: patch.pageId !== undefined ? patch.pageId : base.pageId,
  };
}

/** Which page frame should render this text (live drag may differ from home page). */
export function textRenderPageId(
  homePageId: PageId,
  live?: TextLiveTransform | null,
): PageId {
  return live?.pageId ?? homePageId;
}
