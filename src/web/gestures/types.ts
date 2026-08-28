import type { DesktopNavMode } from '../../input/desktopNavKeys';
import type { ClipId, ClipMeta, PageId, PointerKind, TextId, ToolId } from '../../domain/types';
import type { GestureHit } from '../../domain/workspaceGestures';

export type { GestureHit };

type GestureHitWithoutText = Exclude<GestureHit, { kind: 'pageText' | 'pasteboardText' }>;

/** Page number band below a page frame (tap target). */
export type WorkspaceHit =
  | GestureHitWithoutText
  | {
      kind: 'pageText';
      textId: TextId;
      pageId: PageId;
      localX: number;
      localY: number;
      grabOffsetX: number;
      grabOffsetY: number;
      readingIndex: number;
      insertIndex: number;
    }
  | {
      kind: 'pasteboardText';
      textId: TextId;
      grabOffsetX: number;
      grabOffsetY: number;
    }
  | { kind: 'pageNumber'; pageId: PageId; readingIndex: number }
  | { kind: 'append' }
  | { kind: 'clip'; clipId: ClipId; handle: 'body' | 'corner' | 'rotate' };

export type WorkspaceSessionMode =
  | 'idle'
  | 'fingerPending'
  | 'pan'
  | 'pinch'
  | 'zoomDrag'
  | 'grabPage'
  | 'penOverlay'
  | 'eraseDirect'
  | 'marquee'
  | 'moveClip'
  | 'scaleClip'
  | 'rotateClip'
  | 'pendingTextMove'
  | 'moveText'
  | 'resizeText'
  | 'pendingChromeTap';

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
  | {
      mode: 'zoomDrag';
      kind: 'finger';
      pointerId: number;
      lastY: number;
      anchorX: number;
      anchorY: number;
    }
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
  | { mode: 'eraseDirect'; kind: 'pencil'; pageId: PageId }
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
  | {
      mode: 'pendingTextMove';
      kind: 'pencil' | 'finger';
      textId: TextId;
      startX: number;
      startY: number;
      grabOffsetX: number;
      grabOffsetY: number;
      pageId?: PageId;
      where: 'page' | 'pasteboard';
    }
  | {
      mode: 'moveText';
      kind: 'pencil' | 'finger';
      textId: TextId;
      grabOffsetX: number;
      grabOffsetY: number;
      pageId?: PageId;
      where: 'page' | 'pasteboard';
    }
  | { mode: 'resizeText'; kind: 'pencil'; textId: TextId }
  | {
      mode: 'pendingChromeTap';
      kind: 'pencil';
      hit: WorkspaceHit;
      startX: number;
      startY: number;
    };

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
  | { type: 'beginEraseDirect'; pageId: PageId }
  | { type: 'eraseDirectMove'; pageId: PageId; x: number; y: number; pressure: number }
  | { type: 'commitEraseDirect'; pageId: PageId }
  | { type: 'marqueePreview'; pageId: PageId; rect: { x: number; y: number; width: number; height: number } }
  | { type: 'completeMarquee'; pageId: PageId; rect: { x: number; y: number; width: number; height: number } }
  | { type: 'createText'; pageId: PageId; x: number; y: number }
  | { type: 'selectText'; textId: TextId }
  | { type: 'moveText'; textId: TextId; x: number; y: number }
  | { type: 'textTransformLive'; textId: TextId; x: number; y: number; pageId?: PageId }
  | { type: 'commitTextTransform'; textId: TextId; x: number; y: number; pageId?: PageId }
  | { type: 'resizeText'; textId: TextId; x: number; y: number }
  | { type: 'moveClip'; clipId: ClipId; x: number; y: number }
  | { type: 'scaleClip'; clipId: ClipId; scale: number }
  | { type: 'rotateClip'; clipId: ClipId; rotation: number }
  | {
      type: 'clipTransformLive';
      clipId: ClipId;
      x?: number;
      y?: number;
      scale?: number;
      rotation?: number;
    }
  | { type: 'commitClipTransform'; clipId: ClipId }
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
  /** Screen clientX */
  x: number;
  /** Screen clientY */
  y: number;
  /** Workspace world X (pan/zoom adjusted, surface-relative). */
  worldX: number;
  /** Workspace world Y (pan/zoom adjusted, surface-relative). */
  worldY: number;
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
  mapInkToPage?: (pageId: PageId, clientX: number, clientY: number) => { x: number; y: number } | null;
  /** DOM page-frame coords only (no strip/world fallback). Used for text placement. */
  mapPageDomLocal?: (pageId: PageId, clientX: number, clientY: number) => { x: number; y: number } | null;
  pointerType?: PointerEvent['pointerType'];
  desktopNav?: DesktopNavMode;
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
