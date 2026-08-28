import {
  NUMBER_BAND,
  PAGE_DISPLAY_H,
  PAGE_NUMBER_BAND,
  buildStripFrames,
  clampRasterPoint,
  hitStripFrame,
  pageLocalFromWorld,
  screenToWorld,
} from '../../domain/stripGeometry';
import { pointInRect } from '../../domain/drop';
import type { ClipId, ClipMeta, PageId, PageText, PasteboardText, ToolId } from '../../domain/types';
import { hitClipAt } from '../clip/clipGeometry';
import { pageInkLocalFromClient, resolvePageDomHit } from './pageInkDom';
import type { WorkspaceHit } from './types';

export type ResolveWorkspaceHitInput = {
  clientX: number;
  clientY: number;
  surfaceEl: HTMLElement;
  workspaceOrder: PageId[];
  pages: Record<PageId, { texts: PageText[] }>;
  pasteboardClips: ClipMeta[];
  pasteboardTexts: PasteboardText[];
  selectedClipId: ClipId | null;
  panX: number;
  panY: number;
  zoom: number;
  rasterWidth: number;
  rasterHeight: number;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
  /** When set, pen/eraser resolve the page under the pointer (not pasteboard clips). */
  tool?: ToolId;
};

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
    if (pointInRect(localX, localY, text.box)) {
      return { kind: 'pageText', textId: text.id, pageId, localX, localY, readingIndex, insertIndex };
    }
  }
  return null;
}

function hitPasteboardTexts(texts: PasteboardText[], worldX: number, worldY: number): WorkspaceHit | null {
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const text = texts[i]!;
    if (pointInRect(worldX, worldY, text.box)) {
      return { kind: 'pasteboardText', textId: text.id };
    }
  }
  return null;
}

function hitPasteboardClips(
  clips: ClipMeta[],
  selectedClipId: ClipId | null,
  worldX: number,
  worldY: number,
  rasterWidth: number,
  rasterHeight: number,
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number },
): WorkspaceHit | null {
  if (selectedClipId) {
    const selected = clips.find((c) => c.id === selectedClipId);
    if (selected) {
      const handle = hitClipAt(
        worldX,
        worldY,
        selected,
        getClipRasterSize(selected.id),
        rasterWidth,
        rasterHeight,
        true,
      );
      if (handle) {
        return { kind: 'clip', clipId: selected.id, handle };
      }
    }
  }

  for (let i = clips.length - 1; i >= 0; i -= 1) {
    const clip = clips[i]!;
    const handle = hitClipAt(
      worldX,
      worldY,
      clip,
      getClipRasterSize(clip.id),
      rasterWidth,
      rasterHeight,
      clip.id === selectedClipId,
    );
    if (handle) {
      return { kind: 'clip', clipId: clip.id, handle };
    }
  }
  return null;
}

function resolvePageWorkspaceHit(
  input: ResolveWorkspaceHitInput,
  worldX: number,
  worldY: number,
): WorkspaceHit | null {
  const pageDomHit = resolvePageDomHit(input);
  if (pageDomHit) {
    return pageDomHit;
  }

  const { frames } = buildStripFrames(input.workspaceOrder);
  const frame = hitStripFrame(frames, worldX, worldY);
  if (!frame) {
    return null;
  }

  if (frame.slot.kind === 'append') {
    return { kind: 'append' };
  }

  if (frame.slot.kind === 'blank') {
    return { kind: 'slot', insertIndex: frame.insertIndex };
  }

  if (frame.slot.kind !== 'page') {
    return null;
  }

  const { pageId } = frame.slot;
  const readingIndex = input.workspaceOrder.indexOf(pageId);
  const inNumberBand =
    worldY >= frame.y + PAGE_DISPLAY_H && worldY < frame.y + PAGE_DISPLAY_H + PAGE_NUMBER_BAND;

  if (inNumberBand) {
    return { kind: 'pageNumber', pageId, readingIndex };
  }

  if (worldY >= frame.y + frame.height + PAGE_NUMBER_BAND) {
    return null;
  }

  const page = input.pages[pageId];
  const domLocal = pageInkLocalFromClient(
    input.surfaceEl,
    input.clientX,
    input.clientY,
    pageId,
    input.rasterWidth,
    input.rasterHeight,
  );
  const fallback = pageLocalFromWorld(
    frame,
    worldX,
    worldY,
    input.rasterWidth,
    input.rasterHeight,
  );
  const rasterX = domLocal?.x ?? fallback.x;
  const rasterY = domLocal?.y ?? fallback.y;
  const clamped = clampRasterPoint(rasterX, rasterY, input.rasterWidth, input.rasterHeight);
  const pageTextHit = page
    ? hitPageTexts(pageId, page.texts, clamped.x, clamped.y, readingIndex, frame.insertIndex)
    : null;
  if (pageTextHit) {
    return pageTextHit;
  }

  return {
    kind: 'page',
    pageId,
    localX: clamped.x,
    localY: clamped.y,
    readingIndex,
    insertIndex: frame.insertIndex,
  };
}

export function resolveWorkspaceHit(input: ResolveWorkspaceHitInput): WorkspaceHit {
  const rect = input.surfaceEl.getBoundingClientRect();
  const localX = input.clientX - rect.left;
  const localY = input.clientY - rect.top;
  const { x: worldX, y: worldY } = screenToWorld(localX, localY, input.panX, input.panY, input.zoom);

  // Ink is stored on the page raster under the pointer; floating clips do not capture pen/eraser.
  if (input.tool === 'pen' || input.tool === 'eraser') {
    return resolvePageWorkspaceHit(input, worldX, worldY) ?? { kind: 'empty' };
  }

  const clipHit = hitPasteboardClips(
    input.pasteboardClips,
    input.selectedClipId,
    worldX,
    worldY,
    input.rasterWidth,
    input.rasterHeight,
    input.getClipRasterSize,
  );
  if (clipHit) {
    return clipHit;
  }

  const textHit = hitPasteboardTexts(input.pasteboardTexts, worldX, worldY);
  if (textHit) {
    return textHit;
  }

  return resolvePageWorkspaceHit(input, worldX, worldY) ?? { kind: 'empty' };
}

export function frameForPage(workspaceOrder: PageId[], pageId: PageId) {
  const { frames } = buildStripFrames(workspaceOrder);
  return frames.find((f) => f.slot.kind === 'page' && f.slot.pageId === pageId) ?? null;
}

/** Raster coords on a locked page, even if the pointer is over a neighbor or off-canvas. */
export function inkLocalOnPage(
  input: Pick<
    ResolveWorkspaceHitInput,
    | 'clientX'
    | 'clientY'
    | 'surfaceEl'
    | 'workspaceOrder'
    | 'panX'
    | 'panY'
    | 'zoom'
    | 'rasterWidth'
    | 'rasterHeight'
  >,
  pageId: PageId,
): { x: number; y: number } | null {
  const domLocal = pageInkLocalFromClient(
    input.surfaceEl,
    input.clientX,
    input.clientY,
    pageId,
    input.rasterWidth,
    input.rasterHeight,
  );
  if (domLocal) {
    return domLocal;
  }

  const frame = frameForPage(input.workspaceOrder, pageId);
  if (!frame) {
    return null;
  }
  const rect = input.surfaceEl.getBoundingClientRect();
  const { x: worldX, y: worldY } = screenToWorld(
    input.clientX - rect.left,
    input.clientY - rect.top,
    input.panX,
    input.panY,
    input.zoom,
  );
  const local = pageLocalFromWorld(frame, worldX, worldY, input.rasterWidth, input.rasterHeight);
  return clampRasterPoint(local.x, local.y, input.rasterWidth, input.rasterHeight);
}

export { PAGE_NUMBER_BAND, NUMBER_BAND };
