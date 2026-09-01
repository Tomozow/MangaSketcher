export type OverlayBox = { left: number; top: number; width: number; height: number };

export const OVERLAY_CLAMP_MARGIN_PX = 6;

export function intersectOverlayBoxes(a: OverlayBox, b: OverlayBox): OverlayBox {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** Shrink `view` horizontally so it does not sit under `obstacle` (tool rail, etc.). */
export function subtractHorizontalObstacle(view: OverlayBox, obstacle: OverlayBox): OverlayBox {
  const overlapLeft = Math.max(view.left, obstacle.left);
  const overlapRight = Math.min(view.left + view.width, obstacle.left + obstacle.width);
  const overlapTop = Math.max(view.top, obstacle.top);
  const overlapBottom = Math.min(view.top + view.height, obstacle.top + obstacle.height);
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    return view;
  }
  const viewMid = view.left + view.width / 2;
  const obstacleMid = obstacle.left + obstacle.width / 2;
  if (obstacleMid <= viewMid) {
    const left = Math.max(view.left, obstacle.left + obstacle.width);
    return { left, top: view.top, width: Math.max(0, view.left + view.width - left), height: view.height };
  }
  const right = Math.min(view.left + view.width, obstacle.left);
  return { left: view.left, top: view.top, width: Math.max(0, right - view.left), height: view.height };
}

export function clampOverlayBox(
  box: OverlayBox,
  view: OverlayBox,
  margin = OVERLAY_CLAMP_MARGIN_PX,
): OverlayBox {
  const maxW = Math.max(0, view.width - margin * 2);
  const maxH = Math.max(0, view.height - margin * 2);
  const width = Math.min(Math.max(0, box.width), maxW);
  const height = Math.min(Math.max(0, box.height), maxH);
  const minLeft = view.left + margin;
  const minTop = view.top + margin;
  const maxLeft = view.left + view.width - margin - width;
  const maxTop = view.top + view.height - margin - height;
  return {
    left: Math.min(Math.max(minLeft, box.left), Math.max(minLeft, maxLeft)),
    top: Math.min(Math.max(minTop, box.top), Math.max(minTop, maxTop)),
    width,
    height,
  };
}

export function clientBoxToLocal(
  box: { left: number; top: number; width: number; height: number },
  origin: { left: number; top: number },
): OverlayBox {
  return {
    left: box.left - origin.left,
    top: box.top - origin.top,
    width: box.width,
    height: box.height,
  };
}
