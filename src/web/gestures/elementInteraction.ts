import type { PageId, PageText, PasteboardText, Rect, TextId } from '../../domain/types';
import { layoutVisibleTextBox } from '../../domain/textWrap';
import {
  buildStripFrames,
  pageInkFrameAtWorld,
  pageLocalFromWorld,
  type StripFrame,
} from '../../domain/stripGeometry';

export type TextInteractionElement = {
  id: TextId;
  owner: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
  worldBox: Rect;
  sourceBox: Rect;
  zIndex: number;
};

const finiteOr = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

export function pageBoxToWorld(
  frame: Pick<StripFrame, 'x' | 'y' | 'width' | 'height'>,
  box: Rect,
  rasterWidth: number,
  rasterHeight: number,
): Rect {
  return {
    x: frame.x + (finiteOr(box.x) / rasterWidth) * frame.width,
    y: frame.y + (finiteOr(box.y) / rasterHeight) * frame.height,
    width: (Math.max(4, finiteOr(box.width, 4)) / rasterWidth) * frame.width,
    height: (Math.max(4, finiteOr(box.height, 4)) / rasterHeight) * frame.height,
  };
}

export function worldBoxToPage(
  frame: Pick<StripFrame, 'x' | 'y' | 'width' | 'height'>,
  box: Rect,
  rasterWidth: number,
  rasterHeight: number,
): Rect {
  return {
    x: ((finiteOr(box.x) - frame.x) / frame.width) * rasterWidth,
    y: ((finiteOr(box.y) - frame.y) / frame.height) * rasterHeight,
    width: (Math.max(0, finiteOr(box.width)) / frame.width) * rasterWidth,
    height: (Math.max(0, finiteOr(box.height)) / frame.height) * rasterHeight,
  };
}

/** Keep the on-screen box size when a text moves between page raster space and pasteboard world space. */
export function textBoxForOwnerMove(input: {
  sourceWhere: 'page' | 'pasteboard';
  sourcePageId?: PageId;
  sourceBox: Rect;
  x: number;
  y: number;
  targetPasteboard?: boolean;
  targetPageId?: PageId;
  frameForPageId: (pageId: PageId) => Pick<StripFrame, 'x' | 'y' | 'width' | 'height'> | null;
  rasterWidth: number;
  rasterHeight: number;
}): Rect {
  const safeBox = {
    x: finiteOr(input.sourceBox.x),
    y: finiteOr(input.sourceBox.y),
    width: Math.max(4, finiteOr(input.sourceBox.width, 4)),
    height: Math.max(4, finiteOr(input.sourceBox.height, 4)),
  };
  if (input.targetPasteboard) {
    if (input.sourceWhere === 'page' && input.sourcePageId) {
      const frame = input.frameForPageId(input.sourcePageId);
      if (frame) {
        const world = pageBoxToWorld(frame, safeBox, input.rasterWidth, input.rasterHeight);
        return { x: input.x, y: input.y, width: world.width, height: world.height };
      }
    }
    return { ...safeBox, x: input.x, y: input.y };
  }
  const targetPageId = input.targetPageId;
  if (targetPageId && input.sourceWhere === 'pasteboard') {
    const frame = input.frameForPageId(targetPageId);
    if (frame) {
      const converted = worldBoxToPage(
        frame,
        { x: frame.x, y: frame.y, width: safeBox.width, height: safeBox.height },
        input.rasterWidth,
        input.rasterHeight,
      );
      return { x: input.x, y: input.y, width: converted.width, height: converted.height };
    }
  }
  return { ...safeBox, x: input.x, y: input.y };
}

export type TextOwnerTarget = { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };

export function textWorldBox(input: {
  where: 'page' | 'pasteboard';
  pageId?: PageId;
  box: Rect;
  frames: StripFrame[];
  rasterWidth: number;
  rasterHeight: number;
}): Rect {
  if (input.where === 'page' && input.pageId) {
    const frame = input.frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === input.pageId);
    if (frame) {
      return pageBoxToWorld(frame, input.box, input.rasterWidth, input.rasterHeight);
    }
  }
  return {
    x: finiteOr(input.box.x),
    y: finiteOr(input.box.y),
    width: Math.max(4, finiteOr(input.box.width, 4)),
    height: Math.max(4, finiteOr(input.box.height, 4)),
  };
}

export function textOwnerAtWorld(frames: StripFrame[], worldX: number, worldY: number): TextOwnerTarget {
  const frame = pageInkFrameAtWorld(frames, worldX, worldY);
  if (frame && frame.slot.kind === 'page') {
    return { kind: 'page', pageId: frame.slot.pageId };
  }
  return { kind: 'pasteboard' };
}

/** Convert a world-space origin into the landing owner (page vs pasteboard) and its local box. */
export function textPoseAfterWorldMove(input: {
  sourceWhere: 'page' | 'pasteboard';
  sourcePageId?: PageId;
  sourceBox: Rect;
  sourceFontSize: number;
  worldX: number;
  worldY: number;
  frames: StripFrame[];
  rasterWidth: number;
  rasterHeight: number;
}): { attachment: TextOwnerTarget; box: Rect; fontSize: number } {
  const attachment = textOwnerAtWorld(input.frames, input.worldX, input.worldY);
  const frameForPageId = (pageId: PageId) =>
    input.frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === pageId) ?? null;
  let x = input.worldX;
  let y = input.worldY;
  let targetPageId: PageId | undefined;
  let targetPasteboard = false;
  if (attachment.kind === 'page') {
    targetPageId = attachment.pageId;
    const frame = frameForPageId(targetPageId);
    if (frame) {
      const local = pageLocalFromWorld(frame, input.worldX, input.worldY, input.rasterWidth, input.rasterHeight);
      x = local.x;
      y = local.y;
    }
  } else {
    targetPasteboard = true;
  }
  const box = textBoxForOwnerMove({
    sourceWhere: input.sourceWhere,
    sourcePageId: input.sourcePageId,
    sourceBox: input.sourceBox,
    x,
    y,
    targetPasteboard,
    targetPageId,
    frameForPageId,
    rasterWidth: input.rasterWidth,
    rasterHeight: input.rasterHeight,
  });
  return { attachment, box, fontSize: input.sourceFontSize };
}

export function buildTextInteractionElements(input: {
  workspaceOrder: PageId[];
  pages: Record<PageId, { texts: PageText[] }>;
  pasteboardTexts: PasteboardText[];
  rasterWidth: number;
  rasterHeight: number;
  frames?: StripFrame[];
}): TextInteractionElement[] {
  const frames = input.frames ?? buildStripFrames(input.workspaceOrder).frames;
  const frameByPage = new Map<PageId, StripFrame>();
  for (const frame of frames) {
    if (frame.slot.kind === 'page') {
      frameByPage.set(frame.slot.pageId, frame);
    }
  }

  const result: TextInteractionElement[] = [];
  let zIndex = 0;
  for (const pageId of input.workspaceOrder) {
    const frame = frameByPage.get(pageId);
    if (!frame) continue;
    for (const text of input.pages[pageId]?.texts ?? []) {
      const fontSize = Number.isFinite(text.fontSize) ? text.fontSize : 12;
      const visible = layoutVisibleTextBox(text.box, text.content, fontSize, text.writingMode);
      result.push({
        id: text.id,
        owner: { kind: 'page', pageId },
        sourceBox: { ...visible },
        worldBox: pageBoxToWorld(frame, visible, input.rasterWidth, input.rasterHeight),
        zIndex: zIndex++,
      });
    }
  }
  for (const text of input.pasteboardTexts) {
    const box = {
      x: finiteOr(text.box.x),
      y: finiteOr(text.box.y),
      width: Math.max(4, finiteOr(text.box.width, 4)),
      height: Math.max(4, finiteOr(text.box.height, 4)),
    };
    result.push({
      id: text.id,
      owner: { kind: 'pasteboard' },
      sourceBox: { ...box },
      worldBox: { ...box },
      zIndex: zIndex++,
    });
  }
  return result;
}

function pointInRect(x: number, y: number, box: Rect, padding: number): boolean {
  return (
    x >= box.x - padding &&
    x <= box.x + box.width + padding &&
    y >= box.y - padding &&
    y <= box.y + box.height + padding
  );
}

export function hitTextInteraction(
  elements: TextInteractionElement[],
  worldX: number,
  worldY: number,
  _selectedTextId: TextId | null,
  padWorld: number,
): { element: TextInteractionElement; handle: 'body' | 'se' } | null {
  const padding = Math.max(0, padWorld);
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]!;
    if (pointInRect(worldX, worldY, element.worldBox, padding)) {
      return { element, handle: 'body' };
    }
  }
  return null;
}
