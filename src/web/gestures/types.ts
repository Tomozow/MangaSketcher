import type { DesktopNavMode } from '../../input/desktopNavKeys';
import type { ClipId, ClipMeta, PageId, PointerKind, Rect, SelectTargetFlags, TextId, ToolId } from '../../domain/types';
import type { GestureHit } from '../../domain/workspaceGestures';

export type { GestureHit };

type GestureHitWithoutText = Exclude<GestureHit, { kind: 'pageText' | 'pasteboardText' | 'resizeHandle' }>;

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
      kind: 'resizeHandle';
      textId: TextId;
      owner: 'page' | 'pasteboard';
      pageId?: PageId;
      worldBox: Rect;
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
  | 'lasso'
  | 'moveClip'
  | 'scaleClip'
  | 'rotateClip'
  | 'pendingTextMove'
  | 'moveText'
  | 'resizeText'
  | 'pendingChromeTap'
  | 'pendingTextCreate';

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
  | {
      mode: 'grabPage';
      kind: 'finger' | 'pencil';
      pageId: PageId;
      fromIndex: number;
      lastToIndex?: number;
    }
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
      pageId: PageId | null;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
  | {
      mode: 'lasso';
      kind: 'pencil';
      points: Array<{ x: number; y: number }>;
    }
  | { mode: 'moveClip'; kind: 'pencil'; clipId: ClipId; offsetX: number; offsetY: number }
  | {
      mode: 'pendingSelectionMove';
      kind: 'pencil';
      startX: number;
      startY: number;
      startWorldX: number;
      startWorldY: number;
      clipIds: ClipId[];
      textIds: TextId[];
      /** Text tool: tap (no drag) collapses multi-select to this id. */
      tapSelectTextId?: TextId;
    }
  | {
      mode: 'moveSelection';
      kind: 'pencil';
      startWorldX: number;
      startWorldY: number;
      clipIds: ClipId[];
      textIds: TextId[];
    }
  | {
      mode: 'scaleClip';
      kind: 'pencil';
      clipId: ClipId;
      startX: number;
      startY: number;
      startScaleX: number;
      startScaleY: number;
      startHalfW: number;
      startHalfH: number;
      rotation: number;
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
  | {
      mode: 'resizeText';
      kind: 'pencil';
      textId: TextId;
      owner: 'page' | 'pasteboard';
      pageId?: PageId;
      startWorldBox: Rect;
    }
  | {
      mode: 'pendingChromeTap';
      kind: 'pencil';
      hit: WorkspaceHit;
      startX: number;
      startY: number;
    }
  | {
      mode: 'pendingTextCreate';
      kind: 'pencil';
      pageId?: PageId;
      startX: number;
      startY: number;
      localX: number;
      localY: number;
      worldX: number;
      worldY: number;
    };

export type WorkspaceEffect =
  | { type: 'panBy'; dx: number; dy: number }
  | { type: 'pinchBy'; scaleBy: number; midDx: number; midDy: number }
  | { type: 'grabPage'; pageId: PageId; fromIndex: number }
  | { type: 'endGrabPage' }
  | { type: 'showPageDelete'; pageId: PageId }
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
  | { type: 'marqueePreview'; pageId: PageId | null; rect: { x: number; y: number; width: number; height: number } }
  | { type: 'completeMarquee'; pageId: PageId | null; rect: { x: number; y: number; width: number; height: number } }
  | { type: 'lassoPreview'; points: Array<{ x: number; y: number }> }
  | { type: 'completeLasso'; points: Array<{ x: number; y: number }> }
  | { type: 'createText'; pageId: PageId; x: number; y: number }
  | { type: 'createText'; pasteboard: true; x: number; y: number }
  | { type: 'selectText'; textId: TextId }
  | { type: 'selectTexts'; textIds: TextId[] }
  | { type: 'beginSelectionMove'; clipIds: ClipId[]; textIds: TextId[] }
  | { type: 'selectionMoveLive'; dx: number; dy: number }
  | { type: 'commitSelectionMove' }
  | { type: 'cancelSelectionMove' }
  | { type: 'moveText'; textId: TextId; x: number; y: number }
  | { type: 'textTransformLive'; textId: TextId; x: number; y: number; pageId?: PageId; pasteboard?: boolean }
  | { type: 'commitTextTransform'; textId: TextId; x: number; y: number; pageId?: PageId; pasteboard?: boolean }
  | { type: 'cancelTextTransform'; textId: TextId }
  | { type: 'textResizeLive'; textId: TextId; box: Rect }
  | { type: 'commitTextResize'; textId: TextId; box: Rect }
  | { type: 'cancelTextResize'; textId: TextId }
  | { type: 'moveClip'; clipId: ClipId; x: number; y: number }
  | { type: 'scaleClip'; clipId: ClipId; scale: number; scaleY?: number }
  | { type: 'rotateClip'; clipId: ClipId; rotation: number }
  | {
      type: 'clipTransformLive';
      clipId: ClipId;
      x?: number;
      y?: number;
      scale?: number;
      scaleY?: number;
      rotation?: number;
    }
  | { type: 'commitClipTransform'; clipId: ClipId }
  | { type: 'cancelClipTransform'; clipId: ClipId }
  | { type: 'selectClip'; clipId: ClipId | null }
  | { type: 'selectClips'; clipIds: ClipId[] }
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
  /** Page/chrome below the active element, used only when committing a drop. */
  dropHit?: WorkspaceHit;
  now: number;
  isPrimary: boolean;
  selectedPageId: PageId | null;
  selectedClipId: ClipId | null;
  selectedClipIds?: ClipId[];
  selectedTextId?: TextId | null;
  selectedTextIds?: TextId[];
  selectTargets?: SelectTargetFlags;
  rasterWidth: number;
  rasterHeight: number;
  getClipMeta: (clipId: ClipId) => ClipMeta | undefined;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
  mapInkToPage?: (pageId: PageId, clientX: number, clientY: number) => { x: number; y: number } | null;
  /** DOM page-frame coords only (no strip/world fallback). Used for text placement. */
  mapPageDomLocal?: (pageId: PageId, clientX: number, clientY: number) => { x: number; y: number } | null;
  mapWorldToPage?: (pageId: PageId, worldX: number, worldY: number) => { x: number; y: number } | null;
  /** Page whose ink rectangle contains this world point (clip-center drop). */
  pageInkAtWorld?: (worldX: number, worldY: number) => { pageId: PageId; localX: number; localY: number } | null;
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
