import { buildStripFrames, clampRasterPoint } from '../../domain/stripGeometry';
import type { PageId, PageText } from '../../domain/types';
import { layoutVisibleTextBox } from '../../domain/textWrap';
import { expandTextHitBox } from './textHit';
import type { WorkspaceHit } from './types';

export const PAGE_INK_FRAME_ATTR = 'data-page-ink-frame';
export const PAGE_INK_PLANE_ATTR = 'data-page-ink-plane';
export const PAGE_NUMBER_BAND_ATTR = 'data-page-number-band';
export const APPEND_SLOT_ATTR = 'data-append-slot';

/** Border-box of the 216×306 page, excluding overflowing text/delete chrome. */
export function pageFrameMapRect(pageFrame: HTMLElement): DOMRectReadOnly {
  const plane = pageFrame.querySelector<HTMLElement>(`[${PAGE_INK_PLANE_ATTR}]`);
  return (plane ?? pageFrame).getBoundingClientRect();
}

export function pageInkLocalFromFrameRect(
  frameRect: DOMRectReadOnly,
  clientX: number,
  clientY: number,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } {
  if (frameRect.width <= 0 || frameRect.height <= 0) {
    return clampRasterPoint(0, 0, rasterWidth, rasterHeight);
  }
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
  const rect = pageFrameMapRect(frameEl);
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return pageInkLocalFromFrameRect(rect, clientX, clientY, rasterWidth, rasterHeight);
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

/** Convert page-raster grab delta to strip world units (textMovePoint subtracts world). */
export function rasterGrabOffsetToWorld(
  rasterDx: number,
  rasterDy: number,
  rasterWidth: number,
  rasterHeight: number,
  frameWidth: number,
  frameHeight: number,
): { grabOffsetX: number; grabOffsetY: number } {
  const rw = rasterWidth > 0 ? rasterWidth : 1;
  const rh = rasterHeight > 0 ? rasterHeight : 1;
  return {
    grabOffsetX: (rasterDx / rw) * frameWidth,
    grabOffsetY: (rasterDy / rh) * frameHeight,
  };
}

function hitPageTexts(
  pageId: PageId,
  texts: PageText[],
  localX: number,
  localY: number,
  readingIndex: number,
  insertIndex: number,
  rasterWidth: number,
  rasterHeight: number,
  frameWidth: number,
  frameHeight: number,
): WorkspaceHit | null {
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const text = texts[i]!;
    const box = expandTextHitBox(
      layoutVisibleTextBox(
        text.box,
        text.content,
        Number.isFinite(text.fontSize) ? text.fontSize : 12,
        text.writingMode,
      ),
      rasterWidth,
      rasterHeight,
    );
    if (
      localX >= box.x &&
      localX <= box.x + box.width &&
      localY >= box.y &&
      localY <= box.y + box.height
    ) {
      const boxX = Number.isFinite(text.box.x) ? text.box.x : 0;
      const boxY = Number.isFinite(text.box.y) ? text.box.y : 0;
      const grab = rasterGrabOffsetToWorld(
        localX - boxX,
        localY - boxY,
        rasterWidth,
        rasterHeight,
        frameWidth,
        frameHeight,
      );
      return {
        kind: 'pageText',
        textId: text.id,
        pageId,
        localX,
        localY,
        grabOffsetX: grab.grabOffsetX,
        grabOffsetY: grab.grabOffsetY,
        readingIndex,
        insertIndex,
      };
    }
  }
  return null;
}

function pageHitFromFrameEl(
  pageFrame: HTMLElement,
  input: {
    clientX: number;
    clientY: number;
    workspaceOrder: PageId[];
    pages: Record<PageId, { texts: PageText[] }>;
    rasterWidth: number;
    rasterHeight: number;
  },
): WorkspaceHit | null {
  const pageId = pageFrame.getAttribute(PAGE_INK_FRAME_ATTR) as PageId | null;
  if (!pageId) {
    return null;
  }

  const readingIndex = input.workspaceOrder.indexOf(pageId);
  const frame = buildStripFrames(input.workspaceOrder).frames.find(
    (item) => item.slot.kind === 'page' && item.slot.pageId === pageId,
  );
  const insertIndex = frame?.insertIndex ?? Math.max(0, readingIndex);
  const rect = pageFrameMapRect(pageFrame);
  const { x: localX, y: localY } = pageInkLocalFromFrameRect(
    rect,
    input.clientX,
    input.clientY,
    input.rasterWidth,
    input.rasterHeight,
  );

  const page = input.pages[pageId];
  const pageTextHit = page
    ? hitPageTexts(
        pageId,
        page.texts,
        localX,
        localY,
        readingIndex,
        insertIndex,
        input.rasterWidth,
        input.rasterHeight,
        frame?.width ?? rect.width,
        frame?.height ?? rect.height,
      )
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

export function resolveAppendDomHit(input: {
  clientX: number;
  clientY: number;
  surfaceEl: HTMLElement;
}): WorkspaceHit | null {
  const appends = input.surfaceEl.querySelectorAll<HTMLElement>(`[${APPEND_SLOT_ATTR}]`);
  for (const appendEl of appends) {
    const rect = appendEl.getBoundingClientRect();
    if (pointInClientRect(input.clientX, input.clientY, rect)) {
      return { kind: 'append' };
    }
  }
  return null;
}

/** Rect-based hit test — reliable when elementFromPoint returns transform/surface shells (iPad Safari). */
function resolvePageDomHitFromRects(input: {
  clientX: number;
  clientY: number;
  surfaceEl: HTMLElement;
  workspaceOrder: PageId[];
  pages: Record<PageId, { texts: PageText[] }>;
  rasterWidth: number;
  rasterHeight: number;
}): WorkspaceHit | null {
  const numberBands = input.surfaceEl.querySelectorAll<HTMLElement>(`[${PAGE_NUMBER_BAND_ATTR}]`);
  for (const band of numberBands) {
    const rect = band.getBoundingClientRect();
    if (!pointInClientRect(input.clientX, input.clientY, rect)) {
      continue;
    }
    const pageId = band.getAttribute(PAGE_NUMBER_BAND_ATTR) as PageId | null;
    if (!pageId) {
      continue;
    }
    return {
      kind: 'pageNumber',
      pageId,
      readingIndex: input.workspaceOrder.indexOf(pageId),
    };
  }

  const pageFrames = Array.from(
    input.surfaceEl.querySelectorAll<HTMLElement>(`[${PAGE_INK_FRAME_ATTR}]`),
  );
  for (let i = pageFrames.length - 1; i >= 0; i -= 1) {
    const pageFrame = pageFrames[i]!;
    const rect = pageFrameMapRect(pageFrame);
    if (!pointInClientRect(input.clientX, input.clientY, rect)) {
      continue;
    }
    return pageHitFromFrameEl(pageFrame, input);
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
  const rectHit = resolvePageDomHitFromRects(input);
  if (rectHit) {
    return rectHit;
  }

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

  return pageHitFromFrameEl(pageFrame, input);
}
