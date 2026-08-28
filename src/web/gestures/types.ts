import type { ClipId, ClipMeta, PageId, PointerKind, TextId, ToolId } from '../../domain/types';
import type { GestureHit } from '../../domain/workspaceGestures';

export type { GestureHit };

type GestureHitWithoutPageText = Exclude<GestureHit, { kind: 'pageText' }>;

/** Page number band below a page frame (tap target). */
export type WorkspaceHit =
  | GestureHitWithoutPageText
  | {
      kind: 'pageText';
      textId: TextId;
      pageId: PageId;
      localX: number;
      localY: number;
      readingIndex: number;
      insertIndex: number;
    }
  | { kind: 'pageNumber'; pageId: PageId; readingIndex: number }
  | { kind: 'append' }
  | { kind: 'clip'; clipId: ClipId; handle: 'body' | 'corner' | 'rotate' };

export type WorkspaceSessionMode =
  | 'idle'
  | 'fingerPending'
  | 'pan'
  | 'pinch'
  | 'grabPage'
  | 'penOverlay'
  | 'eraseDirect'
  | 'marquee'
  | 'moveClip'
  | 'scaleClip'
  | 'rotateClip'
  | 'pendingTextMove'
  | 'moveText'
  | 'resizeText';

export type WorkspaceSession =
  | { mode: 'idle' }
  | {
      mode: 'fingerPending';
      kind: 'finger';
      hit: WorkspaceHit;
      startX: number;
      startY: number;
      startedAt: number;
    }
  | { mode: 'pan'; kind: 'finger'; lastX: number; lastY: number }
  | { mode: 'pinch'; kind: 'finger'; pointerId: number; partnerId: number; lastDist: number }
  | { mode: 'grabPage'; kind: 'finger'; pageId: PageId; fromIndex: number; lastToIndex?: number }
  | {
      mode: 'penOverlay';
      kind: 'pencil';
      pageId: PageId;
      lastX: number;
      lastY: number;
      lastPressure: number;
    }
  | { mode: 'eraseDirect'; kind: 'pencil'; pageId?: PageId; clipId?: ClipId }
  | {
      mode: 'marquee';
      kind: 'pencil';
      pageId: PageId;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
  | { mode: 'moveClip'; kind: 'pencil'; clipId: ClipId; offsetX: number; offsetY: number }
  | {
      mode: 'scaleClip';
      kind: 'pencil';
      clipId: ClipId;
      startScale: number;
      startDist: number;
      cx: number;
      cy: number;
    }
  | {
      mode: 'rotateClip';
      kind: 'pencil';
      clipId: ClipId;
      startRotation: number;
      startAngle: number;
      cx: number;
      cy: number;
    }
  | { mode: 'pendingTextMove'; kind: 'pencil'; textId: TextId; startX: number; startY: number }
  | { mode: 'moveText'; kind: 'pencil'; textId: TextId }
  | { mode: 'resizeText'; kind: 'pencil'; textId: TextId };

export type WorkspaceEffect =
  | { type: 'panBy'; dx: number; dy: number }
  | { type: 'pinchBy'; scaleBy: number; midDx: number; midDy: number }
  | { type: 'grabPage'; pageId: PageId; fromIndex: number }
  | { type: 'reorderWorkspace'; pageId: PageId; toIndex: number }
  | { type: 'selectPage'; pageId: PageId }
  | { type: 'insertAfterSelected' }
  | { type: 'appendPage' }
  | { type: 'beginPenOverlay'; pageId: PageId; x: number; y: number; pressure: number }
  | { type: 'penOverlayMove'; pageId: PageId; points: Array<{ x: number; y: number; pressure: number }> }
  | { type: 'commitPenOverlay'; pageId: PageId }
  | { type: 'beginEraseDirect'; pageId?: PageId; clipId?: ClipId }
  | { type: 'eraseDirectMove'; pageId?: PageId; clipId?: ClipId; x: number; y: number; pressure: number }
  | { type: 'commitEraseDirect'; pageId?: PageId; clipId?: ClipId }
  | { type: 'marqueePreview'; pageId: PageId; rect: { x: number; y: number; width: number; height: number } }
  | { type: 'completeMarquee'; pageId: PageId; rect: { x: number; y: number; width: number; height: number } }
  | { type: 'createText'; pageId: PageId; x: number; y: number }
  | { type: 'selectText'; textId: TextId }
  | { type: 'moveText'; textId: TextId; x: number; y: number }
  | { type: 'resizeText'; textId: TextId; x: number; y: number }
  | { type: 'moveClip'; clipId: ClipId; x: number; y: number }
  | { type: 'scaleClip'; clipId: ClipId; scale: number }
  | { type: 'rotateClip'; clipId: ClipId; rotation: number }
  | { type: 'selectClip'; clipId: ClipId | null }
  | {
      type: 'dropClipOnPage';
      clipId: ClipId;
      pageId: PageId;
      localX: number;
      localY: number;
    };

export type WorkspacePointerInput = {
  pointerId: number;
  kind: PointerKind;
  phase: 'down' | 'move' | 'up' | 'cancel';
  tool: ToolId;
  x: number;
  y: number;
  pressure: number;
  hit: WorkspaceHit;
  now: number;
  isPrimary: boolean;
  selectedPageId: PageId | null;
  selectedClipId: ClipId | null;
  rasterWidth: number;
  rasterHeight: number;
  getClipMeta: (clipId: ClipId) => ClipMeta | undefined;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
};

export type WorkspaceGestureStore = {
  sessions: Map<number, WorkspaceSession>;
  /** Latest screen position per active finger pointerId (for pinch). */
  fingerPositions: Map<number, { x: number; y: number }>;
};

export function createWorkspaceGestureStore(): WorkspaceGestureStore {
  return { sessions: new Map(), fingerPositions: new Map() };
}

/** touch-action for workspace strip (§3.3). */
export const WORKSPACE_TOUCH_ACTION = 'none' as const;
