'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { dropActions } from '@/src/domain/drop';
import { reduceEditorDocument, type EditorDocumentAction } from '@/src/domain/editorReducer';
import { extractPdfSourceText } from '@/src/domain/pdfExtract';
import { brushRadius } from '@/src/domain/pointers';
import { screenToWorld } from '@/src/domain/stripGeometry';
import { TEXT_MOVE_SLOP } from '@/src/domain/workspaceGestures';
import { defaultTextBox } from '@/src/domain/text';
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
  if ('clipId' in effect && effect.clipId) {
    return rasterIdForClip(doc, effect.clipId);
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

type PencilTapTrack = {
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
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>({
    unsaved: false,
    encodingCount: 0,
  });
  const encodedPngRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const autosaveRef = useRef<AutosaveManager | null>(null);
  const inkUndoRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const historyRef = useRef<EditorHistory | null>(null);
  const pencilTapRef = useRef<PencilTapTrack | null>(null);
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

  useEffect(() => {
    return () => {
      if (inkFrameRafRef.current) {
        cancelAnimationFrame(inkFrameRafRef.current);
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

  const rasterIds = useMemo(
    () => (history ? collectRasterIds(history.present) : []),
    [history?.present],
  );

  const visibleRasterIds = useMemo(
    () => (history ? visiblePageRasterIds(history.present) : []),
    [history?.present],
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
      if (!isPen && !isMouseTool) {
        return;
      }
      pencilTapRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pendingCreate: null,
      };
    };

    const onPointerUp = (event: PointerEvent) => {
      const track = pencilTapRef.current;
      if (!track || track.pointerId !== event.pointerId) {
        return;
      }
      const dist = Math.hypot(event.clientX - track.startX, event.clientY - track.startY);
      const pending = track.pendingCreate;
      pencilTapRef.current = null;

      if (!pending || dist >= TEXT_MOVE_SLOP) {
        return;
      }

      const present = historyRef.current?.present;
      if (!present) {
        return;
      }

      const { width, height } = defaultTextBox(present.rasterWidth, present.rasterHeight);
      setHistory((prev) => {
        if (!prev) {
          return prev;
        }
        const action: EditorDocumentAction = {
          type: 'createText',
          attachment: { kind: 'page', pageId: pending.pageId },
          box: { x: pending.x, y: pending.y, width, height },
        };
        const nextPresent = reduceEditorDocument(prev.present, action, randomId);
        const nextHistory = pushEditorHistory(prev, nextPresent, inkUndoRef.current, false);
        autosaveRef.current?.scheduleSave(nextHistory.present, [], false);
        return nextHistory;
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
  }, []);

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
          setMarqueePreview({ pageId: effect.pageId, rect: effect.rect });
          continue;
        }
        if (effect.type === 'completeMarquee') {
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
          if (!clip || !page) {
            continue;
          }
          const pageUndo = api.engine.bakeClipOntoPage(
            page.rasterId,
            clip.rasterId,
            effect.localX,
            effect.localY,
            clip.scale,
            clip.rotation,
          );
          if (pageUndo.byteLength > 0) {
            inkUndoRef.current.set(page.rasterId, pageUndo.slice(0));
          }
          dispatch({ type: 'commitClipBake', clipId: effect.clipId, pageId: effect.pageId });
          bumpInkFrame();
        }
      }
    },
    [bumpInkFrame, dispatch],
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

  const commitTextEdit = useCallback(
    (textId: string, content: string) => {
      dispatch({ type: 'editText', textId, content });
    },
    [dispatch],
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
      const deferred: WorkspaceEffect[] = [];
      for (const effect of effects) {
        if (effect.type === 'createText') {
          const track = pencilTapRef.current;
          if (track) {
            track.pendingCreate = {
              pageId: effect.pageId,
              x: effect.x,
              y: effect.y,
            };
          }
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
        deferred.push(effect);
      }

      if (inkEffects.length > 0) {
        applyInkEffects(inkEffects, present);
      }

      if (clipEffects.length > 0) {
        applyClipEffects(clipEffects, present);
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
    [applyClipEffects, applyInkEffects, dispatch],
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
    autosaveStatus,
    getPageThumb,
    getClipRasterSize,
    dispatch,
    applyWorkspaceEffects,
    commitTextEdit,
    setTextEditing,
    undo,
    redo,
    onPdfViewChange,
    onPickPdf,
    onDropTextRange,
  };
}

export { colors };
