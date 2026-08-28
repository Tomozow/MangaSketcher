import {
  NUMBER_BAND,
  PAGE_DISPLAY_H,
  buildStripFrames,
  hitStripFrame,
  pageLocalFromWorld,
  screenToWorld,
} from '../../domain/stripGeometry';
import { pointInRect } from '../../domain/drop';
import type { ClipId, ClipMeta, PageId, PageText, PasteboardText } from '../../domain/types';
import { hitClipAt } from '../clip/clipGeometry';
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

export function resolveWorkspaceHit(input: ResolveWorkspaceHitInput): WorkspaceHit {
  const rect = input.surfaceEl.getBoundingClientRect();
  const localX = input.clientX - rect.left;
  const localY = input.clientY - rect.top;
  const { x: worldX, y: worldY } = screenToWorld(localX, localY, input.panX, input.panY, input.zoom);

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

  const { frames } = buildStripFrames(input.workspaceOrder);
  const frame = hitStripFrame(frames, worldX, worldY);
  if (!frame) {
    return { kind: 'empty' };
  }

  if (frame.slot.kind === 'append') {
    return { kind: 'append' };
  }

  if (frame.slot.kind === 'blank') {
    return { kind: 'slot', insertIndex: frame.insertIndex };
  }

  if (frame.slot.kind !== 'page') {
    return { kind: 'empty' };
  }

  const { pageId } = frame.slot;
  const readingIndex = input.workspaceOrder.indexOf(pageId);
  const inNumberBand =
    worldY >= frame.y + PAGE_DISPLAY_H && worldY <= frame.y + PAGE_DISPLAY_H + NUMBER_BAND;

  if (inNumberBand) {
    return { kind: 'pageNumber', pageId, readingIndex };
  }

  const page = input.pages[pageId];
  const { x: rasterX, y: rasterY } = pageLocalFromWorld(
    frame,
    worldX,
    worldY,
    input.rasterWidth,
    input.rasterHeight,
  );
  const pageTextHit = page
    ? hitPageTexts(pageId, page.texts, rasterX, rasterY, readingIndex, frame.insertIndex)
    : null;
  if (pageTextHit) {
    return pageTextHit;
  }

  return {
    kind: 'page',
    pageId,
    localX: rasterX,
    localY: rasterY,
    readingIndex,
    insertIndex: frame.insertIndex,
  };
}

export function frameForPage(workspaceOrder: PageId[], pageId: PageId) {
  const { frames } = buildStripFrames(workspaceOrder);
  return frames.find((f) => f.slot.kind === 'page' && f.slot.pageId === pageId) ?? null;
}
