import { rectsOverlap } from './text';
import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from './stripGeometry';
import type { ClipId, PageText, Rect, StockAttachedText, TextId } from './types';

export type ClipAttachCandidate = {
  clipId: ClipId;
  originX: number;
  originY: number;
  hitBox: Rect;
};

export type TextAttachCandidate = {
  textId: TextId;
  box: Rect;
};

export function cloneStockAttachedTexts(
  texts: readonly StockAttachedText[] | undefined,
): StockAttachedText[] | undefined {
  if (!texts || texts.length === 0) {
    return undefined;
  }
  return texts.map((item) => ({ ...item }));
}

export function restoreAttachedTextBoxes(
  texts: { id: TextId; box: Rect }[],
  clipX: number,
  clipY: number,
  attached: readonly StockAttachedText[] | undefined,
): void {
  for (const att of attached ?? []) {
    const text = texts.find((item) => item.id === att.textId);
    if (!text) {
      continue;
    }
    text.box = { ...text.box, x: clipX + att.offsetX, y: clipY + att.offsetY };
  }
}

/**
 * Selected texts whose boxes overlap a clip are bundled onto that clip (first clip wins).
 * Remaining texts stay independent stock items.
 */
export function assignOverlappingTextsToClips(
  clips: readonly ClipAttachCandidate[],
  texts: readonly TextAttachCandidate[],
): { attachedByClip: Map<ClipId, StockAttachedText[]>; leftoverTextIds: TextId[] } {
  const used = new Set<TextId>();
  const attachedByClip = new Map<ClipId, StockAttachedText[]>();
  for (const clip of clips) {
    const attached: StockAttachedText[] = [];
    for (const text of texts) {
      if (used.has(text.textId) || !rectsOverlap(clip.hitBox, text.box)) {
        continue;
      }
      used.add(text.textId);
      attached.push({
        textId: text.textId,
        offsetX: text.box.x - clip.originX,
        offsetY: text.box.y - clip.originY,
      });
    }
    attachedByClip.set(clip.clipId, attached);
  }
  return {
    attachedByClip,
    leftoverTextIds: texts.filter((text) => !used.has(text.textId)).map((text) => text.textId),
  };
}

type ClipThumbTextSource = {
  id: TextId;
  content: string;
  box: Rect;
  fontSize: number;
  color: string;
  writingMode?: import('./types').WritingMode;
};

/** Map bundled pasteboard texts into clip-raster space for `drawPageTextsOnThumb`. */
export function attachedTextsToClipRasterTexts(
  attached: readonly StockAttachedText[] | undefined,
  texts: readonly ClipThumbTextSource[],
  clipScale: number,
  _clipRaster: { width: number; height: number },
  pageRasterWidth: number,
  pageRasterHeight: number,
  clipScaleY: number = clipScale,
): PageText[] {
  if (!attached || attached.length === 0) {
    return [];
  }
  const scaleX = Number.isFinite(clipScale) && clipScale > 0 ? clipScale : 1;
  const scaleY = Number.isFinite(clipScaleY) && clipScaleY > 0 ? clipScaleY : scaleX;
  const sx = PAGE_DISPLAY_W / Math.max(1, pageRasterWidth);
  const sy = PAGE_DISPLAY_H / Math.max(1, pageRasterHeight);
  const invX = 1 / (sx * scaleX);
  const invY = 1 / (sy * scaleY);
  const result: PageText[] = [];
  for (const att of attached) {
    const text = texts.find((item) => item.id === att.textId);
    if (!text) {
      continue;
    }
    result.push({
      id: text.id,
      content: text.content,
      color: text.color,
      fontSize: text.fontSize / scaleX,
      writingMode: text.writingMode,
      box: {
        x: att.offsetX * invX,
        y: att.offsetY * invY,
        width: Math.max(0, text.box.width) * invX,
        height: Math.max(0, text.box.height) * invY,
      },
    });
  }
  return result;
}
