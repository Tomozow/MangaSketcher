import type { EditorDocumentAction } from '../../domain/editorReducer';
import type { EditorDocument } from '../../storage/types';
import type { WorkspaceEffect } from './types';

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

export type WorkspaceEffectBatch = {
  view?: { zoom: number; panX: number; panY: number };
  actions: EditorDocumentAction[];
  grabbedPageId: string | null | undefined;
};

export function reduceWorkspaceEffects(
  doc: EditorDocument,
  effects: WorkspaceEffect[],
  fingerPositions: Map<number, { x: number; y: number }>,
  surfaceRect: DOMRect | null,
): WorkspaceEffectBatch {
  let zoom = doc.workspaceZoom;
  let panX = doc.workspacePanX;
  let panY = doc.workspacePanY;
  const actions: EditorDocumentAction[] = [];
  let grabbedPageId: string | null | undefined;

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
      case 'selectPage':
        actions.push({ type: 'selectPage', pageId: effect.pageId });
        break;
      case 'insertAfterSelected':
        actions.push({ type: 'insertAfterSelected' });
        break;
      case 'appendPage':
        actions.push({ type: 'appendPage' });
        break;
      case 'selectText':
        actions.push({ type: 'selectText', textId: effect.textId });
        break;
      case 'selectClip':
        actions.push({ type: 'selectClip', clipId: effect.clipId });
        break;
      case 'moveClip':
        actions.push({ type: 'transformClip', clipId: effect.clipId, x: effect.x, y: effect.y });
        break;
      case 'scaleClip':
        actions.push({ type: 'transformClip', clipId: effect.clipId, scale: effect.scale });
        break;
      case 'rotateClip':
        actions.push({ type: 'transformClip', clipId: effect.clipId, rotation: effect.rotation });
        break;
      case 'grabPage':
        grabbedPageId = effect.pageId;
        break;
      case 'endGrabPage':
        grabbedPageId = null;
        break;
      case 'showPageDelete':
        break;
      case 'reorderWorkspace': {
        const fromIndex = doc.workspaceOrder.indexOf(effect.pageId);
        if (fromIndex === -1) {
          break;
        }
        let toIndex = effect.toIndex;
        if (toIndex < 0) {
          toIndex = doc.workspaceOrder.length;
        }
        if (fromIndex === toIndex) {
          break;
        }
        actions.push({ type: 'reorderWorkspace', fromIndex, toIndex });
        break;
      }
      default:
        break;
    }
  }

  const viewChanged =
    zoom !== doc.workspaceZoom || panX !== doc.workspacePanX || panY !== doc.workspacePanY;

  return {
    view: viewChanged ? { zoom, panX, panY } : undefined,
    actions,
    grabbedPageId,
  };
}
