'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dropActions } from '@/src/domain/drop';
import { reduceEditorDocument, type EditorDocumentAction } from '@/src/domain/editorReducer';
import { extractPdfSourceText } from '@/src/domain/pdfExtract';
import { brushRadius } from '@/src/domain/pointers';
import { clampRasterPoint, pageLocalFromWorld, screenToWorld } from '@/src/domain/stripGeometry';
import { TEXT_MOVE_SLOP } from '@/src/domain/workspaceGestures';
import { defaultTextBox, findText, isTextContentEmpty, clampTextBoxOrigin } from '@/src/domain/text';
import type { StrokePoint } from '@/src/domain/stroke';
import { AutosaveManager, type AutosaveStatus } from '@/src/storage/autosave';
import { editorHistoryFromBoot, loadEditorBoot } from '@/src/storage/editorBoot';
import { writeProjectPdf } from '@/src/storage/projectStore';
import { randomId } from '@/src/storage/randomId';
import {
  isViewOnlyHistoryAction,
  pushEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from '@/src/storage/history';
import { copySharedTransparentPng } from '@/src/storage/transparentPng';
import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  type EditorDocument,
  type EditorHistory,
} from '@/src/storage/types';
import { colors } from '@/src/theme/tokens';
import type { WorkspaceEffect } from '@/src/web/gestures';
import { frameForPage, reduceWorkspaceEffects } from '@/src/web/gestures';
import {
  type ClipLiveTransform,
  effectiveClipPose,
  mergeClipLive,
} from '@/src/web/clip/clipLiveTransform';
import {
  type TextLiveTransform,
  mergeTextLive,
  sanitizeTextBox,
} from '@/src/web/text/textLiveTransform';
import { pageLocalRectToWorld } from './clip/clipGeometry';
import { MIN_MARQUEE_RASTER_PX } from './clip/constants';
import {
  createInkRestoreSink,
  appendLiveBrushStroke,
  type DrawTemplate,
  type InkAutosaveSink,
  useInkEngine,
  type InkEngineApi,
  repaintInkDisplay,
} from '@/src/web/ink';
import { rasterIdForClip } from '@/src/web/PageInkOverlay';
import type { PageId, Rect } from '@/src/domain/types';
import { resolveWorkspaceHit } from '@/src/web/gestures/resolveHit';
import { PDF_WORKER_SRC } from '@/src/web/pdf/constants';
import { dropPdfSession } from '@/src/web/pdf/pdfSession';

import type { TextEditSelection } from '@/src/web/TextEditBar';

type PendingPdfTextDrag = {
  pdfPage: number;
  range: Rect;
  preview: string;
};

export type MarqueePreview = {
  pageId: PageId;
  rect: { x: number; y: number; width: number; height: number };
};

export type { ClipLiveTransform, TextLiveTransform };

type EditorController = {
  ready: boolean;
  missing: boolean;
  history: EditorHistory | null;
  pdfMissing: boolean;
  pdfBytes: ArrayBuffer | null;
  textEditing: boolean;
  textSelection: TextEditSelection | null;
  viewportBottom: number;
  ink: InkEngineApi | null;
  inkFrame: number;
  marqueePreview: MarqueePreview | null;
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
  autosaveStatus: AutosaveStatus;
  getPageThumb: (pageId: PageId) => ImageBitmap | undefined;
  getClipRasterSize: (clipId: string) => { width: number; height: number };
  dispatch: (action: EditorDocumentAction) => void;
  applyWorkspaceEffects: (
    effects: WorkspaceEffect[],
    fingerPositions: Map<number, { x: number; y: number }>,
    surfaceRect: DOMRect | null,
  ) => string | null | undefined;
  commitTextEdit: (textId: string, content: string) => void;
  deleteText: (textId: string) => void;
  setTextEditing: (editing: boolean) => void;
  undo: () => void;
  redo: () => void;
  onPdfViewChange: (patch: {
    currentPage?: number;
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
  onPickPdf: (file: File) => Promise<void>;
  onDropTextRange: (payload: PendingPdfTextDrag) => void;
};

function selectedTextFromDocument(doc: EditorDocument): TextEditSelection | null {
  if (!doc.selectedTextId) {
    return null;
  }
  for (const page of Object.values(doc.pages)) {
    const text = page.texts.find((item) => item.id === doc.selectedTextId);
    if (text) {
      return { id: text.id, content: text.content };
    }
  }
  const pasteboard = doc.pasteboardTexts.find((item) => item.id === doc.selectedTextId);
  if (pasteboard) {
    return { id: pasteboard.id, content: pasteboard.content };
  }
  return null;
}

function collectRasterIds(doc: EditorDocument): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const page of Object.values(doc.pages)) {
    if (!seen.has(page.rasterId)) {
      seen.add(page.rasterId);
      ids.push(page.rasterId);
    }
  }
  for (const clip of doc.pasteboardClips) {
    if (!seen.has(clip.rasterId)) {
      seen.add(clip.rasterId);
      ids.push(clip.rasterId);
    }
  }
  return ids;
}

function visiblePageRasterIds(doc: EditorDocument): string[] {
  const ids: string[] = [];
  for (const pageId of doc.workspaceOrder) {
    const rasterId = doc.pages[pageId]?.rasterId;
    if (rasterId) {
      ids.push(rasterId);
    }
  }
  return ids;
}

function documentRasterIdsKey(doc: EditorDocument): string {
  const pageRasterIds = Object.values(doc.pages)
    .map((page) => page.rasterId)
    .sort()
    .join('\0');
  const clipRasterIds = doc.pasteboardClips
    .map((clip) => clip.rasterId)
    .sort()
    .join('\0');
  return `${pageRasterIds}|${clipRasterIds}`;
}

function workspaceVisibleRasterIdsKey(doc: EditorDocument): string {
  return doc.workspaceOrder.map((pageId) => doc.pages[pageId]?.rasterId ?? '').join('\0');
}

function isClipLiveEffect(effect: WorkspaceEffect): boolean {
  return effect.type === 'clipTransformLive' || effect.type === 'commitClipTransform';
}

function isTextLiveEffect(effect: WorkspaceEffect): boolean {
  return effect.type === 'textTransformLive' || effect.type === 'commitTextTransform';
}

function isClipCanvasEffect(effect: WorkspaceEffect): boolean {
  return (
    effect.type === 'marqueePreview' ||
    effect.type === 'completeMarquee' ||
    effect.type === 'dropClipOnPage'
  );
}

function isInkWorkspaceEffect(effect: WorkspaceEffect): boolean {
  return (
    effect.type === 'beginPenOverlay' ||
    effect.type === 'penOverlayMove' ||
    effect.type === 'commitPenOverlay' ||
    effect.type === 'beginEraseDirect' ||
    effect.type === 'eraseDirectMove' ||
    effect.type === 'commitEraseDirect'
  );
}

function rasterIdForInkEffect(doc: EditorDocument, effect: WorkspaceEffect): string | null {
  if ('pageId' in effect && effect.pageId) {
    return doc.pages[effect.pageId]?.rasterId ?? null;
  }
  return null;
}

function penStrokeStyle(doc: EditorDocument): {
  color: string;
  lineWidth: number;
  globalAlpha: number;
  composite: GlobalCompositeOperation;
} {
  return {
    color: doc.tools.penColor,
    lineWidth: doc.tools.penSize,
    globalAlpha: doc.tools.penOpacity,
    composite: 'source-over',
  };
}

function eraseStrokeStyle(
  doc: EditorDocument,
  pressure: number,
): {
  color: string;
  lineWidth: number;
  globalAlpha: number;
  composite: GlobalCompositeOperation;
} {
  return {
    color: '#000000',
    lineWidth: brushRadius(doc.tools.eraserSize, pressure, 'pencil') * 2,
    globalAlpha: doc.tools.eraserOpacity,
    composite: 'destination-out',
  };
}

type PendingCreate = {
  pageId: string;
  x: number;
  y: number;
};

type TextTapTrack = {
  pointerId: number;
  startX: number;
  startY: number;
  pendingCreate: PendingCreate | null;
};

export function useEditorController(projectId: string): EditorController {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [pdfMissing, setPdfMissing] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pendingPdfTextDrop, setPendingPdfTextDrop] = useState(false);
  const [textEditing, setTextEditing] = useState(false);
  const [viewportBottom, setViewportBottom] = useState(0);
  const [bootEncodedPng, setBootEncodedPng] = useState<ReadonlyMap<string, ArrayBuffer>>(new Map());
  const [inkFrame, setInkFrame] = useState(0);
  const inkFrameRafRef = useRef(0);
  const [marqueePreview, setMarqueePreview] = useState<MarqueePreview | null>(null);
  const marqueeRafRef = useRef(0);
  const pendingMarqueeRef = useRef<MarqueePreview | null>(null);
  const clipLiveRef = useRef<Map<string, ClipLiveTransform>>(new Map());
  const [clipLiveTransforms, setClipLiveTransforms] = useState<Record<string, ClipLiveTransform>>({});
  const clipDragRafRef = useRef(0);
  const textLiveRef = useRef<Map<string, TextLiveTransform>>(new Map());
  const [textLiveTransforms, setTextLiveTransforms] = useState<Record<string, TextLiveTransform>>({});
  const textDragRafRef = useRef(0);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>({
    unsaved: false,
    encodingCount: 0,
  });
  const encodedPngRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const autosaveRef = useRef<AutosaveManager | null>(null);
  const inkUndoRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const historyRef = useRef<EditorHistory | null>(null);
  const textTapRef = useRef<TextTapTrack | null>(null);
  const textTapHandledUpRef = useRef<number | null>(null);
  const textCreateDispatchedRef = useRef(false);

  const createTextAtPointer = useCallback((pending: PendingCreate, pointerType: string, source: string) => {
    if (textCreateDispatchedRef.current) {
      return;
    }
    if (!Number.isFinite(pending.x) || !Number.isFinite(pending.y)) {
      return;
    }
    const present = historyRef.current?.present;
    if (!present) {
      return;
    }
    textCreateDispatchedRef.current = true;
    const { width, height } = defaultTextBox(present.rasterWidth, present.rasterHeight);
    const centered = clampTextBoxOrigin(
      pending.x - width / 2,
      pending.y - height / 2,
      width,
      height,
      present.rasterWidth,
      present.rasterHeight,
    );
    setHistory((prev) => {
      if (!prev) {
        return prev;
      }
      const action: EditorDocumentAction = {
        type: 'createText',
        attachment: { kind: 'page', pageId: pending.pageId },
        box: { x: centered.x, y: centered.y, width, height },
      };
      const nextPresent = reduceEditorDocument(prev.present, action, randomId);
      const nextHistory = pushEditorHistory(prev, nextPresent, inkUndoRef.current, false);
      // #region agent log
      fetch('http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6c5c15'},body:JSON.stringify({sessionId:'6c5c15',location:'useEditorController.tsx:createTextDispatch',message:'createText dispatched',data:{pageId:pending.pageId,tapX:pending.x,tapY:pending.y,boxX:centered.x,boxY:centered.y,width,height,selectedTextId:nextPresent.selectedTextId,pointerType,source},timestamp:Date.now(),hypothesisId:'E',runId:'coord-fix'})}).catch(()=>{});
      // #endregion
      autosaveRef.current?.scheduleSave(nextHistory.present, [], false);
      return nextHistory;
    });
  }, []);
  const templateImageRef = useRef<HTMLImageElement | null>(null);
  const inkApiRef = useRef<InkEngineApi | null>(null);
  const lastLiveInkRef = useRef(new Map<string, StrokePoint>());
  const pendingPdfTextRef = useRef<PendingPdfTextDrag | null>(null);
  historyRef.current = history;

  const bumpInkFrame = useCallback(() => {
    if (inkFrameRafRef.current) {
      return;
    }
    inkFrameRafRef.current = requestAnimationFrame(() => {
      inkFrameRafRef.current = 0;
      setInkFrame((frame) => frame + 1);
    });
  }, []);

  const scheduleMarqueePreview = useCallback((preview: MarqueePreview | null) => {
    pendingMarqueeRef.current = preview;
    if (marqueeRafRef.current) {
      return;
    }
    marqueeRafRef.current = requestAnimationFrame(() => {
      marqueeRafRef.current = 0;
      setMarqueePreview(pendingMarqueeRef.current);
    });
  }, []);

  const bumpClipDragFrame = useCallback(() => {
    if (clipDragRafRef.current) {
      return;
    }
    clipDragRafRef.current = requestAnimationFrame(() => {
      clipDragRafRef.current = 0;
      setClipLiveTransforms(Object.fromEntries(clipLiveRef.current));
    });
  }, []);

  const bumpTextDragFrame = useCallback(() => {
    if (textDragRafRef.current) {
      return;
    }
    textDragRafRef.current = requestAnimationFrame(() => {
      textDragRafRef.current = 0;
      setTextLiveTransforms(Object.fromEntries(textLiveRef.current));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (inkFrameRafRef.current) {
        cancelAnimationFrame(inkFrameRafRef.current);
      }
      if (marqueeRafRef.current) {
        cancelAnimationFrame(marqueeRafRef.current);
      }
      if (clipDragRafRef.current) {
        cancelAnimationFrame(clipDragRafRef.current);
      }
    };
  }, []);

  const emptyPng = useMemo(() => copySharedTransparentPng(), []);

  const drawTemplate = useCallback<DrawTemplate>((ctx, width, height) => {
    const img = templateImageRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, width, height);
    }
  }, []);

  const rasterIdsKey = history ? documentRasterIdsKey(history.present) : '';
  const visibleRasterIdsKey = history ? workspaceVisibleRasterIdsKey(history.present) : '';

  const rasterIds = useMemo(
    () => (history ? collectRasterIds(history.present) : []),
    [history, rasterIdsKey],
  );

  const visibleRasterIds = useMemo(
    () => (history ? visiblePageRasterIds(history.present) : []),
    [history, visibleRasterIdsKey],
  );

  const inkAutosaveSink = useMemo((): InkAutosaveSink => {
    return {
      notifyEncodingStarted: (rasterId) => {
        autosaveRef.current?.notifyEncodingStarted(rasterId);
      },
      notifyEncodingComplete: (rasterId, buffer) => {
        encodedPngRef.current.set(rasterId, buffer);
        autosaveRef.current?.notifyEncodingComplete(rasterId, buffer);
      },
      scheduleDocumentSave: (dirtyRasterIds) => {
        const present = historyRef.current?.present;
        if (present) {
          autosaveRef.current?.scheduleSave(present, dirtyRasterIds, false);
        }
      },
    };
  }, []);

  const ink = useInkEngine({
    rasterWidth: history?.present.rasterWidth ?? DEFAULT_RASTER_WIDTH,
    rasterHeight: history?.present.rasterHeight ?? DEFAULT_RASTER_HEIGHT,
    emptyPng,
    rasterIds,
    visibleRasterIds,
    encodedByRasterId: bootEncodedPng,
    drawTemplate,
    autosaveSink: inkAutosaveSink,
  });

  inkApiRef.current = history ? ink : null;

  const inkRestoreSink = useMemo(() => createInkRestoreSink(ink.engine), [ink.engine]);

  const textSelection = useMemo(
    (): TextEditSelection | null => (history ? selectedTextFromDocument(history.present) : null),
    [history?.present],
  );

  useEffect(() => {
    const img = new Image();
    img.src = '/page_template.jpg';
    img.onload = () => {
      templateImageRef.current = img;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const boot = await loadEditorBoot(projectId);
      if (cancelled) {
        return;
      }
      if (!boot) {
        setMissing(true);
        router.replace('/');
        return;
      }

      encodedPngRef.current = new Map(boot.encodedPng);
      setBootEncodedPng(new Map(boot.encodedPng));
      setPdfMissing(boot.pdfMissing);
      setPdfBytes(boot.pdfFile ? await boot.pdfFile.arrayBuffer() : null);
      setHistory(editorHistoryFromBoot(boot));

      autosaveRef.current = new AutosaveManager({
        getEncodedPng: () => encodedPngRef.current,
        onStatusChange: setAutosaveStatus,
      });

      setReady(true);
    })();

    return () => {
      cancelled = true;
      autosaveRef.current?.dispose();
      autosaveRef.current = null;
    };
  }, [projectId, router]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const syncBarOffset = () => {
      const gap = window.innerHeight - (viewport.offsetTop + viewport.height);
      setViewportBottom(Math.max(0, gap));
    };

    syncBarOffset();
    viewport.addEventListener('resize', syncBarOffset);
    viewport.addEventListener('scroll', syncBarOffset);
    return () => {
      viewport.removeEventListener('resize', syncBarOffset);
      viewport.removeEventListener('scroll', syncBarOffset);
    };
  }, []);

  useEffect(() => {
    const flushHidden = () => {
      autosaveRef.current?.flushHidden();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushHidden();
        return;
      }
      autosaveRef.current?.resumePendingEncodes((rasterId) => {
        inkApiRef.current?.engine.restartEncode(rasterId);
      });
    };

    window.addEventListener('pagehide', flushHidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushHidden);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const isPen = event.pointerType === 'pen';
      const isMouseTool = event.pointerType === 'mouse' && event.button === 0;
      const isFinger = event.pointerType === 'touch';
      // #region agent log
      fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'6c5c15',location:'useEditorController.tsx:textTapDown',message:'global pointerdown',data:{pointerType:event.pointerType,tracked:isPen||isMouseTool||isFinger},timestamp:Date.now(),hypothesisId:'A',runId:'post-fix'})}).catch(()=>{});
      // #endregion
      if (!isPen && !isMouseTool && !isFinger) {
        return;
      }
      textTapHandledUpRef.current = null;
      textCreateDispatchedRef.current = false;
      textTapRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pendingCreate: null,
      };
    };

    const onPointerUp = (event: PointerEvent) => {
      if (textTapHandledUpRef.current === event.pointerId) {
        return;
      }
      const track = textTapRef.current;
      if (!track || track.pointerId !== event.pointerId) {
        return;
      }
      const pointerId = event.pointerId;
      const endX = event.clientX;
      const endY = event.clientY;
      const pointerType = event.pointerType;

      queueMicrotask(() => {
        const current = textTapRef.current;
        if (!current || current.pointerId !== pointerId) {
          return;
        }
        const pending = current.pendingCreate;
        const dist = Math.hypot(endX - current.startX, endY - current.startY);
        textTapRef.current = null;

        // #region agent log
        fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'6c5c15',location:'useEditorController.tsx:textTapUp',message:'text tap up',data:{pointerType,hasPending:Boolean(pending),dist,pendingPageId:pending?.pageId},timestamp:Date.now(),hypothesisId:'A,E',runId:'post-fix2'})}).catch(()=>{});
        // #endregion

        if (!pending || dist >= TEXT_MOVE_SLOP) {
          return;
        }
        textTapHandledUpRef.current = pointerId;
        createTextAtPointer(pending, pointerType, 'tap-up');
      });
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [createTextAtPointer]);

  const persist = useCallback((nextHistory: EditorHistory, viewOnly: boolean) => {
    autosaveRef.current?.scheduleSave(nextHistory.present, [], viewOnly);
  }, []);

  const dispatch = useCallback(
    (action: EditorDocumentAction) => {
      setHistory((prev) => {
        if (!prev) {
          return prev;
        }
        const viewOnly = isViewOnlyHistoryAction(action.type);
        const nextPresent = reduceEditorDocument(prev.present, action, randomId);
        const nextHistory = pushEditorHistory(prev, nextPresent, inkUndoRef.current, viewOnly);
        persist(nextHistory, viewOnly);
        return nextHistory;
      });
    },
    [persist],
  );

  const getPageThumb = useCallback((pageId: PageId): ImageBitmap | undefined => {
    const rasterId = historyRef.current?.present.pages[pageId]?.rasterId;
    if (!rasterId) {
      return undefined;
    }
    return inkApiRef.current?.getThumb(rasterId);
  }, []);

  const getClipRasterSize = useCallback((clipId: string) => {
    const clip = historyRef.current?.present.pasteboardClips.find((c) => c.id === clipId);
    if (!clip) {
      return { width: 1, height: 1 };
    }
    return inkApiRef.current?.engine.getRasterDimensions(clip.rasterId) ?? { width: 1, height: 1 };
  }, []);

  const applyClipEffects = useCallback(
    (effects: WorkspaceEffect[], present: EditorDocument) => {
      const api = inkApiRef.current;
      if (!api) {
        return;
      }

      for (const effect of effects) {
        if (effect.type === 'marqueePreview') {
          scheduleMarqueePreview({ pageId: effect.pageId, rect: effect.rect });
          continue;
        }
        if (effect.type === 'completeMarquee') {
          pendingMarqueeRef.current = null;
          if (marqueeRafRef.current) {
            cancelAnimationFrame(marqueeRafRef.current);
            marqueeRafRef.current = 0;
          }
          setMarqueePreview(null);
          if (
            effect.rect.width < MIN_MARQUEE_RASTER_PX ||
            effect.rect.height < MIN_MARQUEE_RASTER_PX
          ) {
            continue;
          }
          const page = present.pages[effect.pageId];
          if (!page) {
            continue;
          }
          const frame = frameForPage(present.workspaceOrder, effect.pageId);
          if (!frame) {
            continue;
          }
          const clipId = randomId();
          const rasterId = `${present.projectId}:clip:${clipId}`;
          const world = pageLocalRectToWorld(
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            effect.rect,
            present.rasterWidth,
            present.rasterHeight,
          );
          const pageUndo = api.engine.marqueeCut(page.rasterId, rasterId, effect.rect);
          if (pageUndo.byteLength > 0) {
            inkUndoRef.current.set(page.rasterId, pageUndo.slice(0));
          }
          dispatch({
            type: 'commitMarqueeCut',
            pageId: effect.pageId,
            clipId,
            rasterId,
            workspaceX: world.x,
            workspaceY: world.y,
          });
          bumpInkFrame();
          continue;
        }
        if (effect.type === 'dropClipOnPage') {
          const clip = present.pasteboardClips.find((c) => c.id === effect.clipId);
          const page = present.pages[effect.pageId];
          const frame = frameForPage(present.workspaceOrder, effect.pageId);
          if (!clip || !page || !frame) {
            continue;
          }
          const pose = effectiveClipPose(clip, clipLiveRef.current.get(effect.clipId));
          const local = pageLocalFromWorld(
            frame,
            pose.x,
            pose.y,
            present.rasterWidth,
            present.rasterHeight,
          );
          const bakeAt = clampRasterPoint(
            local.x,
            local.y,
            present.rasterWidth,
            present.rasterHeight,
          );
          const pageUndo = api.engine.bakeClipOntoPage(
            page.rasterId,
            clip.rasterId,
            bakeAt.x,
            bakeAt.y,
            pose.scale,
            pose.rotation,
          );
          if (pageUndo.byteLength > 0) {
            inkUndoRef.current.set(page.rasterId, pageUndo.slice(0));
          }
          dispatch({ type: 'commitClipBake', clipId: effect.clipId, pageId: effect.pageId });
          bumpInkFrame();
        }
      }
    },
    [bumpInkFrame, dispatch, scheduleMarqueePreview],
  );

  const applyClipLiveEffects = useCallback(
    (effects: WorkspaceEffect[], present: EditorDocument) => {
      let changed = false;
      for (const effect of effects) {
        if (effect.type === 'clipTransformLive') {
          const clip = present.pasteboardClips.find((c) => c.id === effect.clipId);
          if (!clip) {
            continue;
          }
          const next = mergeClipLive(clip, clipLiveRef.current.get(effect.clipId), effect);
          clipLiveRef.current.set(effect.clipId, next);
          changed = true;
          continue;
        }
        if (effect.type === 'commitClipTransform') {
          const clip = present.pasteboardClips.find((c) => c.id === effect.clipId);
          const live = clipLiveRef.current.get(effect.clipId);
          clipLiveRef.current.delete(effect.clipId);
          if (clip && live) {
            dispatch({
              type: 'transformClip',
              clipId: effect.clipId,
              x: live.x,
              y: live.y,
              scale: live.scale,
              rotation: live.rotation,
            });
          }
          changed = true;
        }
      }
      if (changed) {
        bumpClipDragFrame();
      }
    },
    [bumpClipDragFrame, dispatch],
  );

  const applyTextLiveEffects = useCallback(
    (effects: WorkspaceEffect[], present: EditorDocument) => {
      const clampOnPage = (pageId: PageId | undefined, box: { x: number; y: number; width: number; height: number }) => {
        if (!pageId || !present.pages[pageId]) {
          return box;
        }
        const origin = clampTextBoxOrigin(
          box.x,
          box.y,
          box.width,
          box.height,
          present.rasterWidth,
          present.rasterHeight,
        );
        return { ...box, ...origin };
      };

      let changed = false;
      for (const effect of effects) {
        if (effect.type === 'textTransformLive') {
          if (!Number.isFinite(effect.x) || !Number.isFinite(effect.y)) {
            continue;
          }
          const found = findText(present, effect.textId);
          if (!found) {
            continue;
          }
          const safeBox = sanitizeTextBox(found.node.box);
          const clamped = clampOnPage(effect.pageId ?? found.pageId, {
            ...safeBox,
            x: effect.x,
            y: effect.y,
          });
          const next = mergeTextLive(found.node.box, textLiveRef.current.get(effect.textId), {
            x: clamped.x,
            y: clamped.y,
            pageId: effect.pageId,
          });
          textLiveRef.current.set(effect.textId, next);
          changed = true;
          continue;
        }
        if (effect.type === 'commitTextTransform') {
          textLiveRef.current.delete(effect.textId);
          const found = findText(present, effect.textId);
          if (found && Number.isFinite(effect.x) && Number.isFinite(effect.y)) {
            const safeBox = sanitizeTextBox(found.node.box);
            const clamped = clampOnPage(effect.pageId ?? found.pageId, {
              ...safeBox,
              x: effect.x,
              y: effect.y,
            });
            if (
              effect.pageId &&
              found.where === 'page' &&
              found.pageId &&
              found.pageId !== effect.pageId
            ) {
              dispatch({
                type: 'transferTextToPage',
                textId: effect.textId,
                pageId: effect.pageId,
                x: clamped.x,
                y: clamped.y,
              });
            } else if (effect.pageId && found.where === 'pasteboard') {
              dispatch({
                type: 'attachTextToPage',
                textId: effect.textId,
                pageId: effect.pageId,
                pageBox: { ...safeBox, x: clamped.x, y: clamped.y },
              });
            } else {
              dispatch({ type: 'moveText', textId: effect.textId, x: clamped.x, y: clamped.y });
            }
          }
          changed = true;
        }
      }
      if (changed) {
        bumpTextDragFrame();
      }
    },
    [bumpTextDragFrame, dispatch],
  );

  const commitInkBake = useCallback(
    (rasterId: string, undoPng: ArrayBuffer) => {
      if (undoPng.byteLength > 0) {
        inkUndoRef.current.set(rasterId, undoPng.slice(0));
      }
      dispatch({ type: 'commitInkBake', rasterId });
      bumpInkFrame();
    },
    [bumpInkFrame, dispatch],
  );

  const applyInkEffects = useCallback(
    (effects: WorkspaceEffect[], present: EditorDocument) => {
      const api = inkApiRef.current;
      if (!api) {
        return;
      }

      let visualBump = false;

      for (const effect of effects) {
        const rasterId = rasterIdForInkEffect(present, effect);
        if (!rasterId) {
          continue;
        }

        switch (effect.type) {
          case 'beginPenOverlay': {
            const ctx = api.beginPenOverlay(rasterId);
            const point: StrokePoint = { x: effect.x, y: effect.y, pressure: effect.pressure };
            const last = appendLiveBrushStroke(ctx, null, [point], (p) => ({
              ...penStrokeStyle(present),
              lineWidth: brushRadius(present.tools.penSize, p.pressure, 'pencil') * 2,
            }));
            if (last) {
              lastLiveInkRef.current.set(rasterId, last);
            }
            visualBump = true;
            break;
          }
          case 'penOverlayMove': {
            const overlayCtx = api.engine.getPenOverlayContext(rasterId);
            if (!overlayCtx) {
              break;
            }
            const last = appendLiveBrushStroke(
              overlayCtx,
              lastLiveInkRef.current.get(rasterId) ?? null,
              effect.points,
              (p) => ({
                ...penStrokeStyle(present),
                lineWidth: brushRadius(present.tools.penSize, p.pressure, 'pencil') * 2,
              }),
            );
            if (last) {
              lastLiveInkRef.current.set(rasterId, last);
            }
            visualBump = true;
            break;
          }
          case 'commitPenOverlay': {
            lastLiveInkRef.current.delete(rasterId);
            const undoPng = api.bakePenOverlay(rasterId);
            commitInkBake(rasterId, undoPng);
            visualBump = true;
            break;
          }
          case 'beginEraseDirect': {
            lastLiveInkRef.current.delete(rasterId);
            api.beginEraseDirect(rasterId);
            visualBump = true;
            break;
          }
          case 'eraseDirectMove': {
            const eraseCtx = api.engine.getHotContext(rasterId);
            if (!eraseCtx) {
              break;
            }
            const point: StrokePoint = { x: effect.x, y: effect.y, pressure: effect.pressure };
            const last = appendLiveBrushStroke(
              eraseCtx,
              lastLiveInkRef.current.get(rasterId) ?? null,
              [point],
              (p) => eraseStrokeStyle(present, p.pressure),
            );
            if (last) {
              lastLiveInkRef.current.set(rasterId, last);
            }
            visualBump = true;
            break;
          }
          case 'commitEraseDirect': {
            lastLiveInkRef.current.delete(rasterId);
            const undoPng = api.finishEraseDirect(rasterId);
            commitInkBake(rasterId, undoPng);
            visualBump = true;
            break;
          }
          default:
            break;
        }
      }

      if (visualBump) {
        const painted = new Set<string>();
        for (const effect of effects) {
          const rasterId = rasterIdForInkEffect(present, effect);
          if (!rasterId || painted.has(rasterId)) {
            continue;
          }
          painted.add(rasterId);
          repaintInkDisplay(rasterId);
        }
        const liveInk = effects.some(
          (effect) =>
            effect.type === 'penOverlayMove' ||
            effect.type === 'eraseDirectMove' ||
            effect.type === 'beginPenOverlay' ||
            effect.type === 'beginEraseDirect',
        );
        const finishedInk = effects.some(
          (effect) => effect.type === 'commitPenOverlay' || effect.type === 'commitEraseDirect',
        );
        if (!liveInk || finishedInk) {
          bumpInkFrame();
        }
      }
    },
    [bumpInkFrame, commitInkBake],
  );

  const deleteText = useCallback(
    (textId: string) => {
      // #region agent log
      fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'6c5c15',location:'useEditorController.tsx:deleteText',message:'deleteText called',data:{textId},timestamp:Date.now(),hypothesisId:'B,C'})}).catch(()=>{});
      // #endregion
      textLiveRef.current.delete(textId);
      setTextLiveTransforms(Object.fromEntries(textLiveRef.current));
      dispatch({ type: 'deleteText', textId });
    },
    [dispatch],
  );

  const commitTextEdit = useCallback(
    (textId: string, content: string) => {
      // #region agent log
      fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'6c5c15',location:'useEditorController.tsx:commitTextEdit',message:'commitTextEdit',data:{textId,contentLen:content.length,empty:isTextContentEmpty(content)},timestamp:Date.now(),hypothesisId:'C,D'})}).catch(()=>{});
      // #endregion
      if (isTextContentEmpty(content)) {
        deleteText(textId);
        return;
      }
      dispatch({ type: 'editText', textId, content });
      dispatch({ type: 'selectText', textId: null });
    },
    [deleteText, dispatch],
  );

  const onPdfViewChange = useCallback(
    (patch: { currentPage?: number; zoom?: number; panX?: number; panY?: number }) => {
      dispatch({ type: 'setPdfView', ...patch });
    },
    [dispatch],
  );

  const onPickPdf = useCallback(
    async (file: File) => {
      const present = historyRef.current?.present;
      if (!present) {
        return;
      }

      const buffer = await file.arrayBuffer();
      // pdf.js / OPFS may detach the buffer they receive; keep an owned copy for React state.
      const owned = buffer.slice(0);
      const opfsPath = await writeProjectPdf(projectId, owned.slice(0));
      const extractBytes = new Uint8Array(owned.slice(0));
      const { pageCount, sourceTextByPage } = await extractPdfSourceText(extractBytes, async (data) => {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
        return pdfjs.getDocument({ data: data.slice() }).promise;
      });

      const nextGeneration = (present.pdf?.generation ?? 0) + 1;
      if (present.pdf) {
        dropPdfSession(present.pdf.opfsPath, present.pdf.generation);
      }

      setPdfBytes(owned);
      setPdfMissing(false);

      dispatch({
        type: 'loadPdf',
        opfsPath,
        pageCount,
        sourceTextByPage,
        generation: nextGeneration,
      });

      if (present.pdf) {
        dispatch({ type: 'setPdfView', currentPage: 1, zoom: 1, panX: 0, panY: 0 });
      }
    },
    [dispatch, projectId],
  );

  const onDropTextRange = useCallback((payload: PendingPdfTextDrag) => {
    pendingPdfTextRef.current = payload;
    setPendingPdfTextDrop(true);
  }, []);

  useEffect(() => {
    if (!pendingPdfTextDrop) {
      return;
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'finger') {
        return;
      }
      const pending = pendingPdfTextRef.current;
      const present = historyRef.current?.present;
      if (!pending || !present) {
        return;
      }

      const pane = document.getElementById('editor-workspace-pane');
      const surfaceEl = pane?.firstElementChild;
      if (!(surfaceEl instanceof HTMLElement)) {
        return;
      }

      const rect = surfaceEl.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        return;
      }

      const hit = resolveWorkspaceHit({
        clientX: event.clientX,
        clientY: event.clientY,
        surfaceEl,
        workspaceOrder: present.workspaceOrder,
        pages: present.pages,
        pasteboardClips: present.pasteboardClips,
        pasteboardTexts: present.pasteboardTexts,
        selectedClipId: present.selectedClipId,
        panX: present.workspacePanX,
        panY: present.workspacePanY,
        zoom: present.workspaceZoom,
        rasterWidth: present.rasterWidth,
        rasterHeight: present.rasterHeight,
        getClipRasterSize: (clipId) => {
          const clip = present.pasteboardClips.find((c) => c.id === clipId);
          if (!clip) {
            return { width: 1, height: 1 };
          }
          return (
            inkApiRef.current?.engine.getRasterDimensions(clip.rasterId) ?? { width: 1, height: 1 }
          );
        },
      });

      let target: Parameters<typeof dropActions>[1] | null = null;
      if (hit.kind === 'page') {
        target = {
          zone: 'page',
          pageId: hit.pageId,
          localX: hit.localX,
          localY: hit.localY,
        };
      } else if (hit.kind === 'empty' || hit.kind === 'pasteboardText' || hit.kind === 'clip') {
        const localX = event.clientX - rect.left;
        const localY = event.clientY - rect.top;
        const { x, y } = screenToWorld(
          localX,
          localY,
          present.workspacePanX,
          present.workspacePanY,
          present.workspaceZoom,
        );
        target = { zone: 'pasteboard', x, y };
      }

      if (!target) {
        return;
      }

      const actions = dropActions(
        { type: 'pdfText', pdfPage: pending.pdfPage, range: pending.range, preview: pending.preview },
        target,
        present.rasterWidth,
        present.rasterHeight,
      );
      if (actions.length === 0) {
        return;
      }

      pendingPdfTextRef.current = null;
      setPendingPdfTextDrop(false);
      for (const action of actions) {
        dispatch(action as EditorDocumentAction);
      }
    };

    document.addEventListener('pointerup', onPointerUp, true);
    return () => document.removeEventListener('pointerup', onPointerUp, true);
  }, [dispatch, pendingPdfTextDrop]);

  const undo = useCallback(() => {
    clipLiveRef.current.clear();
    setClipLiveTransforms({});
    textLiveRef.current.clear();
    setTextLiveTransforms({});
    setHistory((prev) => {
      if (!prev) {
        return prev;
      }
      const next = undoEditorHistory(prev, inkRestoreSink);
      if (!next) {
        return prev;
      }
      autosaveRef.current?.scheduleSave(next.present, [], false);
      bumpInkFrame();
      return next;
    });
  }, [inkRestoreSink]);

  const redo = useCallback(() => {
    clipLiveRef.current.clear();
    setClipLiveTransforms({});
    textLiveRef.current.clear();
    setTextLiveTransforms({});
    setHistory((prev) => {
      if (!prev) {
        return prev;
      }
      const next = redoEditorHistory(prev, inkRestoreSink);
      if (!next) {
        return prev;
      }
      autosaveRef.current?.scheduleSave(next.present, [], false);
      bumpInkFrame();
      return next;
    });
  }, [inkRestoreSink]);

  const applyWorkspaceEffects = useCallback(
    (
      effects: WorkspaceEffect[],
      fingerPositions: Map<number, { x: number; y: number }>,
      surfaceRect: DOMRect | null,
    ): string | null | undefined => {
      const present = historyRef.current?.present;
      if (!present || effects.length === 0) {
        return undefined;
      }

      const inkEffects: WorkspaceEffect[] = [];
      const clipEffects: WorkspaceEffect[] = [];
      const clipLiveEffects: WorkspaceEffect[] = [];
      const textLiveEffects: WorkspaceEffect[] = [];
      const deferred: WorkspaceEffect[] = [];
      for (const effect of effects) {
        if (effect.type === 'createText') {
          const track = textTapRef.current;
          const pending = {
            pageId: effect.pageId,
            x: effect.x,
            y: effect.y,
          };
          const pointerType = track ? 'touch' : 'unknown';
          // #region agent log
          fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'6c5c15',location:'useEditorController.tsx:createTextEffect',message:'createText effect',data:{pageId:effect.pageId,x:effect.x,y:effect.y,hasTrack:Boolean(track),tool:present.tool,pointerType},timestamp:Date.now(),hypothesisId:'A,E',runId:'ipad-fix'})}).catch(()=>{});
          // #endregion
          createTextAtPointer(pending, pointerType, 'effect');
          continue;
        }
        if (isInkWorkspaceEffect(effect)) {
          inkEffects.push(effect);
          continue;
        }
        if (isClipCanvasEffect(effect)) {
          clipEffects.push(effect);
          continue;
        }
        if (isClipLiveEffect(effect)) {
          clipLiveEffects.push(effect);
          continue;
        }
        if (isTextLiveEffect(effect)) {
          textLiveEffects.push(effect);
          continue;
        }
        deferred.push(effect);
      }

      if (inkEffects.length > 0) {
        applyInkEffects(inkEffects, present);
      }

      if (clipEffects.length > 0) {
        applyClipEffects(clipEffects, present);
      }

      if (clipLiveEffects.length > 0) {
        applyClipLiveEffects(clipLiveEffects, present);
      }

      if (textLiveEffects.length > 0) {
        applyTextLiveEffects(textLiveEffects, present);
      }

      if (deferred.length === 0) {
        return undefined;
      }

      const batch = reduceWorkspaceEffects(present, deferred, fingerPositions, surfaceRect);
      if (batch.view) {
        dispatch({
          type: 'setWorkspaceView',
          zoom: batch.view.zoom,
          panX: batch.view.panX,
          panY: batch.view.panY,
        });
      }
      for (const action of batch.actions) {
        dispatch(action);
      }
      return batch.grabbedPageId;
    },
    [applyClipEffects, applyClipLiveEffects, applyInkEffects, applyTextLiveEffects, createTextAtPointer, dispatch],
  );

  return {
    ready,
    missing,
    history,
    pdfMissing,
    pdfBytes,
    textEditing,
    textSelection,
    viewportBottom,
    ink: history ? ink : null,
    inkFrame,
    marqueePreview,
    clipLiveTransforms,
    textLiveTransforms,
    autosaveStatus,
    getPageThumb,
    getClipRasterSize,
    dispatch,
    applyWorkspaceEffects,
    commitTextEdit,
    deleteText,
    setTextEditing,
    undo,
    redo,
    onPdfViewChange,
    onPickPdf,
    onDropTextRange,
  };
}

export { colors };
