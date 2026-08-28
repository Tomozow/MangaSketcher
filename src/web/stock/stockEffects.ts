import type { EditorDocumentAction } from '../../domain/editorReducer';
import type { EditorDocument } from '../../storage/types';
import type { StockEffect } from './types';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function pinchMidpoint(fingerPositions: Map<number, { x: number; y: number }>): { x: number; y: number } | null {
  const points = [...fingerPositions.values()];
  if (points.length < 2) {
    return null;
  }
  const a = points[0]!;
  const b = points[1]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export type StockEffectBatch = {
  view?: { zoom: number; panX: number; panY: number };
  actions: EditorDocumentAction[];
  draggedPageId: string | null | undefined;
};

export function reduceStockEffects(
  doc: EditorDocument,
  effects: StockEffect[],
  fingerPositions: Map<number, { x: number; y: number }>,
  surfaceRect: DOMRect | null,
): StockEffectBatch {
  let zoom = doc.stockZoom;
  let panX = doc.stockPanX;
  let panY = doc.stockPanY;
  const actions: EditorDocumentAction[] = [];
  let draggedPageId: string | null | undefined;

  for (const effect of effects) {
    switch (effect.type) {
      case 'panBy':
        panX += effect.dx;
        panY += effect.dy;
        break;
      case 'pinchBy': {
        const mid = pinchMidpoint(fingerPositions);
        const newZoom = clampZoom(zoom * effect.scaleBy);
        if (mid && surfaceRect) {
          const lx = mid.x - surfaceRect.left;
          const ly = mid.y - surfaceRect.top;
          const ratio = newZoom / zoom;
          panX = lx - (lx - panX) * ratio + effect.midDx;
          panY = ly - (ly - panY) * ratio + effect.midDy;
        } else {
          panX += effect.midDx;
          panY += effect.midDy;
        }
        zoom = newZoom;
        break;
      }
      case 'dragPage':
        draggedPageId = effect.pageId;
        break;
      default:
        break;
    }
  }

  const viewChanged = zoom !== doc.stockZoom || panX !== doc.stockPanX || panY !== doc.stockPanY;

  return {
    view: viewChanged ? { zoom, panX, panY } : undefined,
    actions,
    draggedPageId,
  };
}