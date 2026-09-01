import {
  PAGE_DISPLAY_H,
  PAGE_DISPLAY_W,
  PAGE_NUMBER_BAND,
  buildStripFrames,
  stripLayoutFromDoc,
  unionFrameRect,
  type StripFrame,
} from '../../domain/stripGeometry';
import type { EditorDocument, PageId } from '../../domain/types';
import { MINI_NAME_MAX_EDGE, MINI_NAME_TILE_WIDTH } from './constants';

export type MiniNameTile = {
  kind: 'page' | 'blank' | 'cover';
  pageId: PageId | null;
  workspaceNumber: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MiniNameSheetLayout = {
  tiles: MiniNameTile[];
  dividers: { x: number; y: number; height: number }[];
  width: number;
  height: number;
  pixelScale: number;
  numberBand: number;
};

export function buildMiniNameFileName(stem: string, timestamp: string): string {
  return `${stem}_${timestamp}_mininame.jpg`;
}

export function collectMiniNameFrames(frames: readonly StripFrame[]): StripFrame[] {
  return frames.filter((frame) => frame.slot.kind === 'page' || frame.slot.kind === 'blank');
}

export function miniNameSheetLayout(doc: EditorDocument): MiniNameSheetLayout {
  const { frames, dividers } = buildStripFrames(doc.workspaceOrder, stripLayoutFromDoc(doc));
  const source = collectMiniNameFrames(frames);
  const pageRects = source.map((frame) => ({
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height + (frame.slot.kind === 'page' ? PAGE_NUMBER_BAND : 0),
  }));
  const bounds = unionFrameRect(pageRects);
  if (!bounds || source.length === 0) {
    return { tiles: [], dividers: [], width: 1, height: 1, pixelScale: 1, numberBand: 0 };
  }

  const displayScale = MINI_NAME_TILE_WIDTH / PAGE_DISPLAY_W;
  const fitted = fitPixelScale(bounds.width * displayScale, bounds.height * displayScale);
  const pixelScale = displayScale * fitted;
  const originX = bounds.x;
  const originY = bounds.y;

  const tiles: MiniNameTile[] = source.map((frame) => ({
    kind: frame.slot.kind === 'page' ? 'page' : 'blank',
    pageId: frame.slot.kind === 'page' ? frame.slot.pageId : null,
    workspaceNumber: frame.slot.kind === 'page' ? frame.slot.number : null,
    x: (frame.x - originX) * pixelScale,
    y: (frame.y - originY) * pixelScale,
    width: PAGE_DISPLAY_W * pixelScale,
    height: PAGE_DISPLAY_H * pixelScale,
  }));
  markCoverBlank(tiles);

  return {
    tiles,
    dividers: dividers.map((divider) => ({
      x: (divider.x - originX) * pixelScale,
      y: (divider.y - originY) * pixelScale,
      height: divider.height * pixelScale,
    })),
    width: Math.max(1, Math.round(bounds.width * pixelScale)),
    height: Math.max(1, Math.round(bounds.height * pixelScale)),
    pixelScale,
    numberBand: PAGE_NUMBER_BAND * pixelScale,
  };
}

function fitPixelScale(width: number, height: number): number {
  const longest = Math.max(width, height, 1);
  return Math.min(1, MINI_NAME_MAX_EDGE / longest);
}

function markCoverBlank(tiles: MiniNameTile[]): void {
  let cover: MiniNameTile | null = null;
  for (const tile of tiles) {
    if (tile.kind !== 'blank') {
      continue;
    }
    if (!cover || tile.y < cover.y - 0.01 || (Math.abs(tile.y - cover.y) < 0.01 && tile.x > cover.x)) {
      cover = tile;
    }
  }
  if (cover) {
    cover.kind = 'cover';
  }
}

export function formatMiniNameCoverDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}年${month}月${day}日 ${hours}:${minutes}`;
}

export function wrapCoverText(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const source = text.trim().length === 0 ? '無題' : text.trim();
  const lines: string[] = [];
  let current = '';
  for (const ch of source) {
    if (ch === '\n') {
      lines.push(current.length === 0 ? ' ' : current);
      current = '';
      continue;
    }
    const next = current + ch;
    if (current.length > 0 && measure(next) > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current.length > 0 || lines.length === 0) {
    lines.push(current.length === 0 ? '無題' : current);
  }
  return lines;
}
