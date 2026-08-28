import type { PageId, PageText } from '../../domain/types';
import { PAGE_INK_FRAME_ATTR, pageFrameMapRect, pageInkLocalFromFrameRect } from './pageInkDom';
import { MIN_TEXT_HIT_CSS } from './textHit';
import type { WorkspaceHit } from './types';

export const PAGE_TEXT_WRAP_ATTR = 'data-page-text-wrap';
export const PAGE_TEXT_ID_ATTR = 'data-text-id';
export const PAGE_TEXT_PAGE_ATTR = 'data-page-id';
export const PAGE_TEXT_DELETE_ATTR = 'data-page-text-delete';
export const PAGE_TEXT_COPY_ATTR = 'data-page-text-copy';
export const PAGE_TEXT_CHROME_ATTR = 'data-page-text-chrome';

function workspaceRoot(surfaceEl: HTMLElement): HTMLElement {
  return surfaceEl;
}

function pointInClientRect(
  clientX: number,
  clientY: number,
  rect: DOMRectReadOnly,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function pointInExpandedClientRect(
  clientX: number,
  clientY: number,
  rect: DOMRectReadOnly,
): boolean {
  const extra = Math.max(0, MIN_TEXT_HIT_CSS - rect.width);
  return (
    clientX >= rect.left - extra &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function parseZIndex(el: HTMLElement): number {
  const raw = window.getComputedStyle(el).zIndex;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Hit test against rendered text wrap bounds (DOM getBoundingClientRect). */
export function hitPageTextFromDom(input: {
  clientX: number;
  clientY: number;
  surfaceEl: HTMLElement;
  workspaceOrder: PageId[];
  pages: Record<PageId, { texts: PageText[] }>;
  rasterWidth: number;
  rasterHeight: number;
}): WorkspaceHit | null {
  const root = workspaceRoot(input.surfaceEl);
  const chromeHits = Array.from(root.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_CHROME_ATTR}]`));
  if (
    chromeHits.some((chrome) => pointInClientRect(input.clientX, input.clientY, chrome.getBoundingClientRect()))
  ) {
    return null;
  }
  const wraps = Array.from(root.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_WRAP_ATTR}]`));

  const candidates = wraps
    .map((wrap, domIndex) => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      if (!pointInExpandedClientRect(input.clientX, input.clientY, rect)) {
        return null;
      }
      return { wrap, domIndex, zIndex: parseZIndex(wrap) };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.zIndex - a.zIndex || b.domIndex - a.domIndex);

  const top = candidates[0];
  if (!top) {
    return null;
  }

  const wrap = top.wrap;
  const textId = wrap.getAttribute(PAGE_TEXT_ID_ATTR);
  const pageId = wrap.getAttribute(PAGE_TEXT_PAGE_ATTR) as PageId | null;
  if (!textId || !pageId) {
    return null;
  }

  const page = input.pages[pageId];
  const text = page?.texts.find((item) => item.id === textId);
  if (!text) {
    return null;
  }

  const pageFrame = input.surfaceEl.querySelector<HTMLElement>(`[${PAGE_INK_FRAME_ATTR}="${pageId}"]`);
  if (!pageFrame) {
    return null;
  }

  const frameRect = pageFrameMapRect(pageFrame);
  if (frameRect.width <= 0 || frameRect.height <= 0) {
    return null;
  }

  const { x: localX, y: localY } = pageInkLocalFromFrameRect(
    frameRect,
    input.clientX,
    input.clientY,
    input.rasterWidth,
    input.rasterHeight,
  );

  const boxX = Number.isFinite(text.box.x) ? text.box.x : 0;
  const boxY = Number.isFinite(text.box.y) ? text.box.y : 0;

  const readingIndex = input.workspaceOrder.indexOf(pageId);
  const insertIndex = Math.max(0, readingIndex);

  return {
    kind: 'pageText',
    textId,
    pageId,
    localX,
    localY,
    grabOffsetX: localX - boxX,
    grabOffsetY: localY - boxY,
    readingIndex,
    insertIndex,
  };
}
