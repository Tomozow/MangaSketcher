import {
  clampColumnGap,
  clampPairGap,
  PAGE_DISPLAY_H,
  PAGE_DISPLAY_W,
  PAGE_NUMBER_BAND,
  screenToWorld,
  SPREAD_INNER_GAP,
} from '@/src/domain/stripGeometry';
import { type WorldAabb } from '@/src/web/clip/clipGeometry';

export type { WorldAabb };

export function workspaceSurfaceWorldAabb(
  surfaceWidth: number,
  surfaceHeight: number,
  panX: number,
  panY: number,
  zoom: number,
): WorldAabb | null {
  if (!(surfaceWidth > 0) || !(surfaceHeight > 0)) {
    return null;
  }
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const tl = screenToWorld(0, 0, panX, panY, z);
  const br = screenToWorld(surfaceWidth, surfaceHeight, panX, panY, z);
  return {
    minX: Math.min(tl.x, br.x),
    minY: Math.min(tl.y, br.y),
    maxX: Math.max(tl.x, br.x),
    maxY: Math.max(tl.y, br.y),
  };
}

export function inflateWorldAabb(aabb: WorldAabb, padX: number, padY: number): WorldAabb {
  const x = Number.isFinite(padX) ? Math.max(0, padX) : 0;
  const y = Number.isFinite(padY) ? Math.max(0, padY) : 0;
  return {
    minX: aabb.minX - x,
    minY: aabb.minY - y,
    maxX: aabb.maxX + x,
    maxY: aabb.maxY + y,
  };
}

/** One packed cell: spread width × row stride (not “one spread” when several share a row). */
export function workspaceCellPad(
  pairGap?: number,
  columnGap?: number,
): { padX: number; padY: number } {
  return {
    padX: 2 * PAGE_DISPLAY_W + SPREAD_INNER_GAP + clampPairGap(pairGap),
    padY: PAGE_DISPLAY_H + PAGE_NUMBER_BAND + clampColumnGap(columnGap),
  };
}

export function worldAabbsIntersect(a: WorldAabb, b: WorldAabb): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function pageInkWorldAabb(frame: { x: number; y: number; width: number }): WorldAabb {
  return {
    minX: frame.x,
    minY: frame.y,
    maxX: frame.x + frame.width,
    maxY: frame.y + PAGE_DISPLAY_H,
  };
}

export type CullInkRaster = {
  rasterId: string;
  aabb: WorldAabb;
};

export type CullWorkspaceInkInput = {
  surfaceWidth: number;
  surfaceHeight: number;
  panX: number;
  panY: number;
  zoom: number;
  pairGap?: number;
  columnGap?: number;
  pages: readonly CullInkRaster[];
  clips: readonly CullInkRaster[];
  alwaysDisplayRasterIds?: readonly string[];
};

function pushUnique(out: string[], seen: Set<string>, rasterId: string): void {
  if (!rasterId || seen.has(rasterId)) {
    return;
  }
  seen.add(rasterId);
  out.push(rasterId);
}

/**
 * Display = viewport inflated by one cell; pin = viewport inflated by two cells.
 * Size 0 does not mount everything — only `alwaysDisplayRasterIds`.
 */
export function cullWorkspaceInkRasters(input: CullWorkspaceInkInput): {
  displayRasterIds: string[];
  pinRasterIds: string[];
} {
  const always = input.alwaysDisplayRasterIds ?? [];
  const display: string[] = [];
  const displaySeen = new Set<string>();
  for (const id of always) {
    pushUnique(display, displaySeen, id);
  }

  const view = workspaceSurfaceWorldAabb(
    input.surfaceWidth,
    input.surfaceHeight,
    input.panX,
    input.panY,
    input.zoom,
  );
  if (!view) {
    return { displayRasterIds: display, pinRasterIds: [...display] };
  }

  const cell = workspaceCellPad(input.pairGap, input.columnGap);
  const displayRect = inflateWorldAabb(view, cell.padX, cell.padY);
  const pinRect = inflateWorldAabb(view, cell.padX * 2, cell.padY * 2);
  const items = [...input.pages, ...input.clips];

  for (const item of items) {
    if (worldAabbsIntersect(displayRect, item.aabb)) {
      pushUnique(display, displaySeen, item.rasterId);
    }
  }

  const pin: string[] = [];
  const pinSeen = new Set<string>();
  for (const id of display) {
    pushUnique(pin, pinSeen, id);
  }
  for (const item of items) {
    if (worldAabbsIntersect(pinRect, item.aabb)) {
      pushUnique(pin, pinSeen, item.rasterId);
    }
  }

  return { displayRasterIds: display, pinRasterIds: pin };
}
