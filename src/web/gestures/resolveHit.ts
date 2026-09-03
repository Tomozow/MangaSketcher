import {
  NUMBER_BAND,
  PAGE_DISPLAY_H,
  PAGE_NUMBER_BAND,
  PAGE_NUMBER_HIT_H,
  PAGE_NUMBER_HIT_W,
  buildStripFrames,
  clampRasterPoint,
  hitStripFrame,
  pageLocalFromWorld,
  screenToWorld,
  type StripFrame,
} from '../../domain/stripGeometry';
import type { ClipId, ClipMeta, PageId, PageText, PasteboardText, SelectTargetFlags, TextId, ToolId } from '../../domain/types';
import { isSelectionTool } from '../../domain/types';
import { hitClipAt } from '../clip/clipGeometry';
import { pageInkLocalFromClient, resolveAppendDomHit, resolvePageDomHit } from './pageInkDom';
import {
  hitPageTextFromDom,
  PAGE_TEXT_ID_ATTR,
  PAGE_TEXT_PAGE_ATTR,
  PAGE_TEXT_WRAP_ATTR,
} from './pageTextDom';
import { buildTextInteractionElements, hitTextInteraction } from './elementInteraction';
import { TEXT_HIT_PAD_CSS } from './textHit';
import type { WorkspaceHit } from './types';

export type ResolveWorkspaceHitInput = {
  clientX: number;
  clientY: number;
  surfaceEl: HTMLElement;
  surfaceRect?: DOMRectReadOnly;
  frames?: StripFrame[];
  workspaceOrder: PageId[];
  pages: Record<PageId, { texts: PageText[] }>;
  pasteboardClips: ClipMeta[];
  pasteboardTexts: PasteboardText[];
  selectedClipId: ClipId | null;
  selectedClipIds?: ClipId[];
  selectedTextId?: TextId | null;
  panX: number;
  panY: number;
  zoom: number;
  rasterWidth: number;
  rasterHeight: number;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
  /** When set, pen/eraser resolve the page under the pointer (not pasteboard clips). */
  tool?: ToolId;
  selectTargets?: SelectTargetFlags;
};

function hitRenderedTextFromDomStack(
  input: ResolveWorkspaceHitInput,
  rect: DOMRectReadOnly,
  frames: StripFrame[],
  worldX: number,
  worldY: number,
): WorkspaceHit | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  const selector = `[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}]`;
  const wrap = document
    .elementsFromPoint(input.clientX, input.clientY)
    .map((element) => element.closest<HTMLElement>(selector))
    .find((element): element is HTMLElement => element !== null);
  if (!wrap) return null;

  const textId = wrap.getAttribute(PAGE_TEXT_ID_ATTR);
  if (!textId) return null;
  const wrapRect = wrap.getBoundingClientRect();
  const wrapWorld = screenToWorld(
    wrapRect.left - rect.left,
    wrapRect.top - rect.top,
    input.panX,
    input.panY,
    input.zoom,
  );
  const pageId = wrap.getAttribute(PAGE_TEXT_PAGE_ATTR) as PageId | null;
  if (!pageId) {
    return {
      kind: 'pasteboardText',
      textId,
      grabOffsetX: worldX - wrapWorld.x,
      grabOffsetY: worldY - wrapWorld.y,
    };
  }

  const frame = frames.find(
    (candidate) => candidate.slot.kind === 'page' && candidate.slot.pageId === pageId,
  );
  if (!frame) return null;
  const local = pageLocalFromWorld(
    frame,
    worldX,
    worldY,
    input.rasterWidth,
    input.rasterHeight,
  );
  return {
    kind: 'pageText',
    textId,
    pageId,
    localX: local.x,
    localY: local.y,
    grabOffsetX: worldX - wrapWorld.x,
    grabOffsetY: worldY - wrapWorld.y,
    readingIndex: input.workspaceOrder.indexOf(pageId),
    insertIndex: frame.insertIndex,
  };
}

function hitPasteboardClips(
  clips: ClipMeta[],
  selectedClipIds: ClipId[],
  worldX: number,
  worldY: number,
  rasterWidth: number,
  rasterHeight: number,
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number },
  zoom: number,
): WorkspaceHit | null {
  const selectedSet = new Set(selectedClipIds);
  for (let i = clips.length - 1; i >= 0; i -= 1) {
    const clip = clips[i]!;
    if (!selectedSet.has(clip.id)) {
      continue;
    }
    const handle = hitClipAt(
      worldX,
      worldY,
      clip,
      getClipRasterSize(clip.id),
      rasterWidth,
      rasterHeight,
      true,
      zoom,
    );
    if (handle) {
      return { kind: 'clip', clipId: clip.id, handle };
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
      selectedSet.has(clip.id),
      zoom,
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
  frames: StripFrame[],
  skipDom = false,
): WorkspaceHit | null {
  if (!skipDom) {
    const pageDomHit = resolvePageDomHit(input);
    if (pageDomHit) {
      return pageDomHit;
    }
    const appendHit = resolveAppendDomHit(input);
    if (appendHit) {
      return appendHit;
    }
  }

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
  const inPageInk =
    worldX >= frame.x &&
    worldX <= frame.x + frame.width &&
    worldY >= frame.y &&
    worldY < frame.y + frame.height;
  const numberHitCx = frame.x + frame.width / 2;
  const numberHitCy = frame.y + PAGE_DISPLAY_H + PAGE_NUMBER_BAND / 2;
  const inNumberBand =
    worldX >= numberHitCx - PAGE_NUMBER_HIT_W / 2 &&
    worldX <= numberHitCx + PAGE_NUMBER_HIT_W / 2 &&
    worldY >= numberHitCy - PAGE_NUMBER_HIT_H / 2 &&
    worldY <= numberHitCy + PAGE_NUMBER_HIT_H / 2;

  if (inNumberBand) {
    return { kind: 'pageNumber', pageId, readingIndex };
  }

  if (!inPageInk) {
    return null;
  }

  const fallback = pageLocalFromWorld(
    frame,
    worldX,
    worldY,
    input.rasterWidth,
    input.rasterHeight,
  );
  const clamped = clampRasterPoint(fallback.x, fallback.y, input.rasterWidth, input.rasterHeight);
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
  const rect = input.surfaceRect ?? input.surfaceEl.getBoundingClientRect();
  const frames = input.frames ?? buildStripFrames(input.workspaceOrder).frames;

  const localX = input.clientX - rect.left;
  const localY = input.clientY - rect.top;
  const { x: worldX, y: worldY } = screenToWorld(localX, localY, input.panX, input.panY, input.zoom);

  // Ink is stored on the page raster under the pointer; floating clips do not capture pen/eraser.
  if (input.tool === 'pen' || input.tool === 'eraser') {
    return resolvePageWorkspaceHit(input, worldX, worldY, frames) ?? { kind: 'empty' };
  }

  const selectText = !isSelectionTool(input.tool) || input.selectTargets?.text !== false;
  const selectClip = !isSelectionTool(input.tool) || input.selectTargets?.clip !== false;

  if (selectText) {
    const renderedTextHit = hitRenderedTextFromDomStack(input, rect, frames, worldX, worldY);
    if (renderedTextHit) {
      return renderedTextHit;
    }

    const domTextHit = hitPageTextFromDom(input);
    if (domTextHit) {
      return domTextHit;
    }

    const textElements = buildTextInteractionElements({ ...input, frames });
    const textHit = hitTextInteraction(
      textElements,
      worldX,
      worldY,
      input.selectedTextId ?? null,
      TEXT_HIT_PAD_CSS / Math.max(0.1, input.zoom),
    );
    if (textHit) {
      const offsetX = worldX - textHit.element.worldBox.x;
      const offsetY = worldY - textHit.element.worldBox.y;
      if (textHit.element.owner.kind === 'pasteboard') {
        return {
          kind: 'pasteboardText',
          textId: textHit.element.id,
          grabOffsetX: offsetX,
          grabOffsetY: offsetY,
        };
      }
      const pageId = textHit.element.owner.pageId;
      const frame = frames.find(
        (candidate) => candidate.slot.kind === 'page' && candidate.slot.pageId === pageId,
      );
      if (frame) {
        const local = pageLocalFromWorld(
          frame,
          worldX,
          worldY,
          input.rasterWidth,
          input.rasterHeight,
        );
        return {
          kind: 'pageText',
          textId: textHit.element.id,
          pageId,
          localX: local.x,
          localY: local.y,
          grabOffsetX: offsetX,
          grabOffsetY: offsetY,
          readingIndex: input.workspaceOrder.indexOf(pageId),
          insertIndex: frame.insertIndex,
        };
      }
    }
  }

  if (selectClip) {
    const clipHit = hitPasteboardClips(
      input.pasteboardClips,
      input.selectedClipIds ?? (input.selectedClipId ? [input.selectedClipId] : []),
      worldX,
      worldY,
      input.rasterWidth,
      input.rasterHeight,
      input.getClipRasterSize,
      input.zoom,
    );
    if (clipHit) {
      return clipHit;
    }
  }

  return resolvePageWorkspaceHit(input, worldX, worldY, frames) ?? { kind: 'empty' };
}

/** Resolve the page below an active element without allowing that element to capture the drop. */
export function resolveWorkspaceDropTarget(input: ResolveWorkspaceHitInput): WorkspaceHit {
  const rect = input.surfaceRect ?? input.surfaceEl.getBoundingClientRect();
  const { x: worldX, y: worldY } = screenToWorld(
    input.clientX - rect.left,
    input.clientY - rect.top,
    input.panX,
    input.panY,
    input.zoom,
  );
  const frames = input.frames ?? buildStripFrames(input.workspaceOrder).frames;
  return resolvePageWorkspaceHit(input, worldX, worldY, frames, true) ?? { kind: 'empty' };
}

export function frameForPage(
  workspaceOrder: PageId[],
  pageId: PageId,
  frames?: StripFrame[],
) {
  const list = frames ?? buildStripFrames(workspaceOrder).frames;
  return list.find((f) => f.slot.kind === 'page' && f.slot.pageId === pageId) ?? null;
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
    | 'frames'
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

  const frame = frameForPage(input.workspaceOrder, pageId, input.frames);
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
