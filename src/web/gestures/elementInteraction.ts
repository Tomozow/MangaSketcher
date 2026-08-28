import type { PageId, PageText, PasteboardText, Rect, TextId } from '../../domain/types';
import { buildStripFrames, type StripFrame } from '../../domain/stripGeometry';
import { MIN_TEXT_HIT_CSS } from './textHit';

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
      result.push({
        id: text.id,
        owner: { kind: 'page', pageId },
        sourceBox: { ...text.box },
        worldBox: pageBoxToWorld(frame, text.box, input.rasterWidth, input.rasterHeight),
        zIndex: zIndex++,
      });
    }
  }
  for (const text of input.pasteboardTexts) {
    result.push({
      id: text.id,
      owner: { kind: 'pasteboard' },
      sourceBox: { ...text.box },
      worldBox: { ...text.box },
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
  selectedTextId: TextId | null,
  handleWorldSize: number,
): { element: TextInteractionElement; handle: 'body' | 'se' } | null {
  const selected = selectedTextId ? elements.find((element) => element.id === selectedTextId) : undefined;
  if (selected) {
    const seX = selected.worldBox.x + selected.worldBox.width;
    const seY = selected.worldBox.y + selected.worldBox.height;
    if (Math.hypot(worldX - seX, worldY - seY) <= handleWorldSize) {
      return { element: selected, handle: 'se' };
    }
  }

  const padding = Math.max(0, handleWorldSize * 0.35);
  const minBodyWidth = handleWorldSize * (MIN_TEXT_HIT_CSS / 14);
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index]!;
    const bodyBox =
      element.worldBox.width >= minBodyWidth
        ? element.worldBox
        : {
            ...element.worldBox,
            x: element.worldBox.x + element.worldBox.width - minBodyWidth,
            width: minBodyWidth,
          };
    if (pointInRect(worldX, worldY, bodyBox, padding)) {
      return { element, handle: 'body' };
    }
  }
  return null;
}
