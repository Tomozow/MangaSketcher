import { buildStripFrames, clampRasterPoint } from '../../domain/stripGeometry';
import type { PageId, PageText } from '../../domain/types';
import type { WorkspaceHit } from './types';

export const PAGE_INK_FRAME_ATTR = 'data-page-ink-frame';
export const PAGE_NUMBER_BAND_ATTR = 'data-page-number-band';

export function pageInkLocalFromFrameRect(
  frameRect: DOMRectReadOnly,
  clientX: number,
  clientY: number,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } {
  const x = ((clientX - frameRect.left) / frameRect.width) * rasterWidth;
  const y = ((clientY - frameRect.top) / frameRect.height) * rasterHeight;
  return clampRasterPoint(x, y, rasterWidth, rasterHeight);
}

export function pageInkLocalFromClient(
  surfaceEl: HTMLElement,
  clientX: number,
  clientY: number,
  pageId: PageId,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } | null {
  const frameEl = surfaceEl.querySelector<HTMLElement>(`[${PAGE_INK_FRAME_ATTR}="${pageId}"]`);
  if (!frameEl) {
    return null;
  }
  const rect = frameEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return pageInkLocalFromFrameRect(rect, clientX, clientY, rasterWidth, rasterHeight);
}

function hitPageTexts(
  pageId: PageId,
  texts: PageText[],
  localX: number,
  localY: number,
  readingIndex: number,
  insertIndex: number,
): WorkspaceHit | null {
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const text = texts[i]!;
    if (
      localX >= text.box.x &&
      localX <= text.box.x + text.box.width &&
      localY >= text.box.y &&
      localY <= text.box.y + text.box.height
    ) {
      return { kind: 'pageText', textId: text.id, pageId, localX, localY, readingIndex, insertIndex };
    }
  }
  return null;
}

/** Map pointer to page hit using on-screen page frame geometry (zoom/pan safe). */
export function resolvePageDomHit(input: {
  clientX: number;
  clientY: number;
  surfaceEl: HTMLElement;
  workspaceOrder: PageId[];
  pages: Record<PageId, { texts: PageText[] }>;
  rasterWidth: number;
  rasterHeight: number;
}): WorkspaceHit | null {
  const target = document.elementFromPoint(input.clientX, input.clientY);
  if (!target || !input.surfaceEl.contains(target)) {
    return null;
  }

  const numberBand = target.closest(`[${PAGE_NUMBER_BAND_ATTR}]`);
  if (numberBand && input.surfaceEl.contains(numberBand)) {
    const pageId = numberBand.getAttribute(PAGE_NUMBER_BAND_ATTR) as PageId | null;
    if (!pageId) {
      return null;
    }
    return {
      kind: 'pageNumber',
      pageId,
      readingIndex: input.workspaceOrder.indexOf(pageId),
    };
  }

  const pageFrame = target.closest(`[${PAGE_INK_FRAME_ATTR}]`) as HTMLElement | null;
  if (!pageFrame || !input.surfaceEl.contains(pageFrame)) {
    return null;
  }

  const pageId = pageFrame.getAttribute(PAGE_INK_FRAME_ATTR) as PageId | null;
  if (!pageId) {
    return null;
  }

  const readingIndex = input.workspaceOrder.indexOf(pageId);
  const frame = buildStripFrames(input.workspaceOrder).frames.find(
    (item) => item.slot.kind === 'page' && item.slot.pageId === pageId,
  );
  const insertIndex = frame?.insertIndex ?? Math.max(0, readingIndex);
  const rect = pageFrame.getBoundingClientRect();
  const { x: localX, y: localY } = pageInkLocalFromFrameRect(
    rect,
    input.clientX,
    input.clientY,
    input.rasterWidth,
    input.rasterHeight,
  );

  const page = input.pages[pageId];
  const pageTextHit = page
    ? hitPageTexts(pageId, page.texts, localX, localY, readingIndex, insertIndex)
    : null;
  if (pageTextHit) {
    return pageTextHit;
  }

  return {
    kind: 'page',
    pageId,
    localX,
    localY,
    readingIndex,
    insertIndex,
  };
}
