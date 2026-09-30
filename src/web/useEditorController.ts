'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publicUrl } from '@/src/web/publicUrl';
import { reduceEditorDocument, type EditorDocumentAction } from '@/src/domain/editorReducer';
import {
  nextExtractPack,
  startExtractPack,
  extractedTextBoxSize,
  wrapExtractedText,
  workspaceFontSizeFromTool,
  type ExtractPackCursor,
} from '@/src/domain/pdfExtractPack';
import { brushOpacity, brushRadius, pressureAffectsOf } from '@/src/domain/pointers';
import { pageLocalFromWorld, screenToWorld, buildStripFrames, stripLayoutFromDoc, PAGE_DISPLAY_H, PAGE_DISPLAY_W, type StripFrame } from '@/src/domain/stripGeometry';
import { defaultTextBox, findText, isTextContentEmpty, clampTextBoxOrigin, rectsOverlap, selectedTextForEditor, selectedTextIdsOf } from '@/src/domain/text';
import type { StrokePoint } from '@/src/domain/stroke';
import { AutosaveManager, type AutosaveStatus } from '@/src/storage/autosave';
import { getAutosaveDelays, getInkIdleMs } from '@/src/storage/appSettings';
import { editorHistoryFromBoot, loadEditorBoot } from '@/src/storage/editorBoot';
import { applyPdfViewSession, loadPdfViewSession, savePdfViewSession } from '@/src/storage/pdfViewSession';
import { randomId } from '@/src/storage/randomId';
import {
  isViewOnlyHistoryAction,
  pushEditorHistory,
  redoEditorHistory,
  trimEditorHistoryDepth,
  undoEditorHistory,
} from '@/src/storage/history';
import { copySharedTransparentPng } from '@/src/storage/transparentPng';
import { dirtyRasterIdsForAction } from '@/src/storage/dirtyRasters';
import { releaseDefaultStorageDatabase, isDefaultStorageReleased } from '@/src/storage/idb';
import { hardNavigate } from '@/src/web/hardNavigate';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';
import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  type EditorDocument,
  type EditorHistory,
  type InkUndoPixels,
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
import { stockedClipIds, stockedTextIds } from '@/src/domain/stockItems';
import { clipAxisScale, clipMergeLayout, clipTouchesPolygon, clipTouchesWorldRect, clipInsertTarget, clipPoseAfterPixelTrim, intersectRects, pageLocalRectToWorld, polygonAabb, rectTouchesPolygon, selectedClipIdsOf, worldPointsToPageLocal, worldPolygonToClipPixels, worldRectToPageLocalRect } from './clip/clipGeometry';
import { CLIP_DUPLICATE_OFFSET, MIN_MARQUEE_RASTER_PX } from './clip/constants';
import { clipRasterId } from '@/src/storage/rasterIds';
import {
  createInkRestoreSink,
  appendLiveBrushStroke,
  type DrawTemplate,
  type InkAutosaveSink,
  useInkEngine,
  type InkEngineApi,
  repaintInkDisplay,
  scheduleInkDisplay,
} from '@/src/web/ink';
import { scissorsTargetFlagsOf, selectTargetFlagsOf, type ClipId, type PageId, type Rect, type TextId } from '@/src/domain/types';
import { pageBoxToWorld, textBoxForOwnerMove, textPoseAfterWorldMove, textWorldBox } from '@/src/web/gestures/elementInteraction';
import type { PdfExtractPayload } from '@/src/web/pdf/PdfPageViewer';

import type { TextEditSelection } from '@/src/web/TextEditBar';
import { useAppSettings } from '@/src/web/useAppSettings';
import {
  consumePendingInkHistory,
  createInkIdleAutosaveScheduler,
  runEditorCheckpoint,
  runIdleInkAutosave,
  type PendingInkHistoryItem,
} from '@/src/web/editorCheckpoint';
import { importProjectPdf } from '@/src/web/pdfImport';

function takePendingInkUndo(
  inkUndo: Map<string, InkUndoPixels>,
): Map<string, InkUndoPixels> {
  const pending = new Map(inkUndo);
  inkUndo.clear();
  return pending;
}

function stashInkUndo(inkUndo: Map<string, InkUndoPixels>, rasterId: string, undo: InkUndoPixels): void {
  if (undo instanceof ArrayBuffer && undo.byteLength === 0) {
    return;
  }
  inkUndo.set(rasterId, undo);
}

export type MarqueePreview = {
  pageId: PageId | null;
  rect: { x: number; y: number; width: number; height: number };
};

export type LassoPreview = {
  points: Array<{ x: number; y: number }>;
};

function collectTextIdsInWorldRect(
  present: EditorDocument,
  frames: StripFrame[],
  worldRect: Rect,
): TextId[] {
  return collectTextIdsWhere(present, frames, (box) => rectsOverlap(box, worldRect));
}

function collectTextIdsInWorldPolygon(
  present: EditorDocument,
  frames: StripFrame[],
  points: Array<{ x: number; y: number }>,
): TextId[] {
  return collectTextIdsWhere(present, frames, (box) => rectTouchesPolygon(box, points));
}

function collectTextIdsWhere(
  present: EditorDocument,
  frames: StripFrame[],
  hits: (box: Rect) => boolean,
): TextId[] {
  const ids: TextId[] = [];
  const frameByPage = new Map<PageId, StripFrame>();
  for (const frame of frames) {
    if (frame.slot.kind === 'page') {
      frameByPage.set(frame.slot.pageId, frame);
    }
  }
  for (const [pageId, page] of Object.entries(present.pages)) {
    const frame = frameByPage.get(pageId);
    if (!frame) {
      continue;
    }
    for (const text of page.texts) {
      const world = pageBoxToWorld(frame, text.box, present.rasterWidth, present.rasterHeight);
      if (hits(world)) {
        ids.push(text.id);
      }
    }
  }
  const hiddenTexts = stockedTextIds(present.stock);
  for (const id of present.trashTexts ?? []) {
    hiddenTexts.add(id);
  }
  for (const text of present.pasteboardTexts) {
    if (hiddenTexts.has(text.id)) {
      continue;
    }
    if (hits(text.box)) {
      ids.push(text.id);
    }
  }
  return ids;
}

function eligibleScissorsClips(present: EditorDocument) {
  const hidden = stockedClipIds(present.stock);
  for (const id of present.trashClips ?? []) {
    hidden.add(id);
  }
  return present.pasteboardClips.filter((clip) => !hidden.has(clip.id));
}

function commitScissorsCuts(options: {
  present: EditorDocument;
  engine: InkEngineApi['engine'];
  live: ReadonlyMap<string, ClipLiveTransform>;
  worldPoints: Array<{ x: number; y: number }>;
  touches: (
    clip: EditorDocument['pasteboardClips'][number],
    size: { width: number; height: number },
  ) => boolean;
  inkUndo: Map<string, InkUndoPixels>;
  dispatch: (action: EditorDocumentAction) => void;
}): string[] {
  const pieceIds: string[] = [];
  for (const clip of eligibleScissorsClips(options.present)) {
    const pose = effectiveClipPose(clip, options.live.get(clip.id));
    const posed = { ...clip, ...pose };
    const size = options.engine.getRasterDimensions(clip.rasterId);
    if (!options.touches(posed, size)) {
      continue;
    }
    const localPoints = worldPolygonToClipPixels(
      options.worldPoints,
      posed,
      size,
      options.present.rasterWidth,
      options.present.rasterHeight,
    );
    const clipId = randomId();
    const rasterId = clipRasterId(options.present.projectId, clipId);
    const cut = options.engine.cutClipRegion(clip.rasterId, rasterId, localPoints);
    if (!cut.pieceOrigin) {
      continue;
    }
    stashInkUndo(options.inkUndo, clip.rasterId, cut.sourceUndo);
    const piecePose = clipPoseAfterPixelTrim(
      posed,
      size,
      options.present.rasterWidth,
      options.present.rasterHeight,
      cut.pieceOrigin,
    );
    const sourcePose = cut.sourceTrim
      ? clipPoseAfterPixelTrim(
          posed,
          size,
          options.present.rasterWidth,
          options.present.rasterHeight,
          cut.sourceTrim,
        )
      : null;
    const { scaleX, scaleY } = clipAxisScale(posed);
    options.dispatch({
      type: 'commitClipScissorsCut',
      sourceClipId: clip.id,
      sourceEmpty: !cut.sourceTrim,
      sourceX: sourcePose?.x,
      sourceY: sourcePose?.y,
      piece: {
        clipId,
        rasterId,
        x: piecePose.x,
        y: piecePose.y,
        scale: scaleX,
        scaleY,
        rotation: posed.rotation,
      },
    });
    pieceIds.push(clipId);
  }
  return pieceIds;
}

function focusWorkspacePageIfNeeded(
  dispatch: (action: EditorDocumentAction) => void,
  originPageId: string | null | undefined,
  lastCutPageId: string | null,
): void {
  const pageId = originPageId || lastCutPageId;
  if (pageId) {
    dispatch({ type: 'focusWorkspacePage', pageId });
  }
}

function cutPageInkMarquee(options: {
  present: EditorDocument;
  engine: InkEngineApi['engine'];
  frames: StripFrame[];
  worldRect: Rect;
  inkUndo: Map<string, InkUndoPixels>;
  dispatch: (action: EditorDocumentAction) => void;
}): { clipIds: string[]; lastPageId: string | null } {
  const cutClipIds: string[] = [];
  let lastPageId: string | null = null;
  for (const frame of options.frames) {
    if (frame.slot.kind !== 'page') {
      continue;
    }
    const page = options.present.pages[frame.slot.pageId];
    if (!page) {
      continue;
    }
    const localRect = worldRectToPageLocalRect(
      frame,
      options.worldRect,
      options.present.rasterWidth,
      options.present.rasterHeight,
    );
    if (!localRect || localRect.width < MIN_MARQUEE_RASTER_PX || localRect.height < MIN_MARQUEE_RASTER_PX) {
      continue;
    }
    const clipId = randomId();
    const rasterId = `${options.present.projectId}:clip:${clipId}`;
    const cut = options.engine.marqueeCut(page.rasterId, rasterId, localRect);
    if (!cut.trim) {
      continue;
    }
    const trimmedRect = {
      x: localRect.x + cut.trim.x,
      y: localRect.y + cut.trim.y,
      width: cut.trim.width,
      height: cut.trim.height,
    };
    const world = pageLocalRectToWorld(
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      trimmedRect,
      options.present.rasterWidth,
      options.present.rasterHeight,
    );
    stashInkUndo(options.inkUndo, page.rasterId, cut.pageUndo);
    options.dispatch({
      type: 'commitMarqueeCut',
      pageId: frame.slot.pageId,
      clipId,
      rasterId,
      workspaceX: world.x,
      workspaceY: world.y,
    });
    cutClipIds.push(clipId);
    lastPageId = frame.slot.pageId;
  }
  return { clipIds: cutClipIds, lastPageId };
}

function cutPageInkLasso(options: {
  present: EditorDocument;
  engine: InkEngineApi['engine'];
  frames: StripFrame[];
  points: Array<{ x: number; y: number }>;
  inkUndo: Map<string, InkUndoPixels>;
  dispatch: (action: EditorDocumentAction) => void;
}): { clipIds: string[]; lastPageId: string | null } {
  const cutClipIds: string[] = [];
  let lastPageId: string | null = null;
  for (const frame of options.frames) {
    if (frame.slot.kind !== 'page') {
      continue;
    }
    const page = options.present.pages[frame.slot.pageId];
    if (!page) {
      continue;
    }
    const localPoints = worldPointsToPageLocal(
      frame,
      options.points,
      options.present.rasterWidth,
      options.present.rasterHeight,
    );
    const localAabb = polygonAabb(localPoints);
    if (!localAabb) {
      continue;
    }
    const padded = {
      x: localAabb.x - 1,
      y: localAabb.y - 1,
      width: localAabb.width + 2,
      height: localAabb.height + 2,
    };
    const localRect = intersectRects(padded, {
      x: 0,
      y: 0,
      width: options.present.rasterWidth,
      height: options.present.rasterHeight,
    });
    if (!localRect || localRect.width < MIN_MARQUEE_RASTER_PX || localRect.height < MIN_MARQUEE_RASTER_PX) {
      continue;
    }
    const clipId = randomId();
    const rasterId = `${options.present.projectId}:clip:${clipId}`;
    const cut = options.engine.lassoCut(page.rasterId, rasterId, localPoints, localRect);
    if (!cut.trim) {
      continue;
    }
    const trimmedRect = {
      x: localRect.x + cut.trim.x,
      y: localRect.y + cut.trim.y,
      width: cut.trim.width,
      height: cut.trim.height,
    };
    const world = pageLocalRectToWorld(
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      trimmedRect,
      options.present.rasterWidth,
      options.present.rasterHeight,
    );
    stashInkUndo(options.inkUndo, page.rasterId, cut.pageUndo);
    options.dispatch({
      type: 'commitMarqueeCut',
      pageId: frame.slot.pageId,
      clipId,
      rasterId,
      workspaceX: world.x,
      workspaceY: world.y,
    });
    cutClipIds.push(clipId);
    lastPageId = frame.slot.pageId;
  }
  return { clipIds: cutClipIds, lastPageId };
}

function finishScissorsGesture(options: {
  present: EditorDocument;
  engine: InkEngineApi['engine'];
  live: ReadonlyMap<string, ClipLiveTransform>;
  frames: StripFrame[];
  worldPoints: Array<{ x: number; y: number }>;
  worldRect?: Rect;
  mode: 'marquee' | 'lasso';
  originPageId?: string | null;
  inkUndo: Map<string, InkUndoPixels>;
  dispatch: (action: EditorDocumentAction) => void;
}): { clipIds: string[]; textIds: string[] } {
  const targets = scissorsTargetFlagsOf(options.present.tools);
  const pieceIds = targets.clip
    ? commitScissorsCuts({
        present: options.present,
        engine: options.engine,
        live: options.live,
        worldPoints: options.worldPoints,
        touches: (clip, size) =>
          options.mode === 'lasso'
            ? clipTouchesPolygon(
                clip,
                size,
                options.present.rasterWidth,
                options.present.rasterHeight,
                options.worldPoints,
              )
            : clipTouchesWorldRect(
                clip,
                size,
                options.present.rasterWidth,
                options.present.rasterHeight,
                options.worldRect!,
              ),
        inkUndo: options.inkUndo,
        dispatch: options.dispatch,
      })
    : [];
  const pageCut = targets.ink
    ? options.mode === 'lasso'
      ? cutPageInkLasso({
          present: options.present,
          engine: options.engine,
          frames: options.frames,
          points: options.worldPoints,
          inkUndo: options.inkUndo,
          dispatch: options.dispatch,
        })
      : cutPageInkMarquee({
          present: options.present,
          engine: options.engine,
          frames: options.frames,
          worldRect: options.worldRect!,
          inkUndo: options.inkUndo,
          dispatch: options.dispatch,
        })
    : { clipIds: [] as string[], lastPageId: null as string | null };
  const pageClipIds = pageCut.clipIds;
  const clipIds = [...pieceIds, ...pageClipIds];
  const textIds = targets.text
    ? options.mode === 'lasso'
      ? collectTextIdsInWorldPolygon(options.present, options.frames, options.worldPoints)
      : collectTextIdsInWorldRect(options.present, options.frames, options.worldRect!)
    : [];
  if (pageClipIds.length > 0) {
    focusWorkspacePageIfNeeded(options.dispatch, options.originPageId, pageCut.lastPageId);
  }
  if (clipIds.length > 0) {
    options.dispatch({ type: 'selectClips', clipIds });
  } else if (!targets.text) {
    options.dispatch({ type: 'selectClips', clipIds: [] });
  }
  if (targets.text) {
    options.dispatch({ type: 'selectTexts', textIds });
  }
  if (options.present.tools.scissorsSwitchToSelect === true) {
    options.dispatch({ type: 'setTool', tool: 'select' });
  }
  return { clipIds, textIds };
}

export type { ClipLiveTransform, TextLiveTransform };

type EditorController = {
  ready: boolean;
  missing: boolean;
  history: EditorHistory | null;
  pdfMissing: boolean;
  pdfBytes: ArrayBuffer | null;
  textEditing: boolean;
  textSelection: TextEditSelection | null;
  ink: InkEngineApi | null;
  inkFrame: number;
  marqueePreview: MarqueePreview | null;
  lassoPreview: LassoPreview | null;
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
  duplicateText: (textId: string) => void;
  deleteClip: (clipId: string) => void;
  duplicateClip: (clipId: string) => void;
  insertClipOnPage: (clipId: string) => void;
  mergeSelectedClips: (clipId: string) => void;
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
  onExtractPdfText: (payload: PdfExtractPayload) => void;
  clearPageInk: (pageId: PageId) => void;
  checkpointBeforeHeavyWork: () => Promise<void>;
  setTextDraft: (draft: string | null) => void;
};

function selectedTextFromDocument(doc: EditorDocument): TextEditSelection | null {
  const found = selectedTextForEditor(doc);
  if (!found) {
    return null;
  }
  return {
    id: found.id,
    content: found.content,
    color: found.color,
    writingMode: found.writingMode,
    fontSize: found.fontSize,
  };
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

function isClipLiveEffect(effect: WorkspaceEffect): boolean {
  return (
    effect.type === 'clipTransformLive' ||
    effect.type === 'commitClipTransform' ||
    effect.type === 'cancelClipTransform' ||
    effect.type === 'beginSelectionMove' ||
    effect.type === 'selectionMoveLive' ||
    effect.type === 'commitSelectionMove' ||
    effect.type === 'cancelSelectionMove'
  );
}

function isTextLiveEffect(effect: WorkspaceEffect): boolean {
  return (
    effect.type === 'textTransformLive' ||
    effect.type === 'textResizeLive' ||
    effect.type === 'commitTextResize' ||
    effect.type === 'cancelTextResize' ||
    effect.type === 'commitTextTransform' ||
    effect.type === 'cancelTextTransform'
  );
}

function isClipCanvasEffect(effect: WorkspaceEffect): boolean {
  return (
    effect.type === 'marqueePreview' ||
    effect.type === 'completeMarquee' ||
    effect.type === 'lassoPreview' ||
    effect.type === 'completeLasso' ||
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

function inkStrokeStyle(
  doc: EditorDocument,
  pressure: number,
  erase: boolean,
): {
  color: string;
  lineWidth: number;
  globalAlpha: number;
  composite: GlobalCompositeOperation;
} {
  const affect = pressureAffectsOf(doc.tools, erase);
  const size = erase ? doc.tools.eraserSize : doc.tools.penSize;
  const opacity = erase ? doc.tools.eraserOpacity : doc.tools.penOpacity;
  return {
    color: erase ? '#000000' : doc.tools.penColor,
    lineWidth: brushRadius(size, pressure, 'pencil', affect.size) * 2,
    globalAlpha: brushOpacity(opacity, pressure, 'pencil', affect.opacity),
    composite: erase ? 'destination-out' : 'source-over',
  };
}

type PendingCreate =
  | { pageId: string; x: number; y: number }
  | { pasteboard: true; x: number; y: number };

export function useEditorController(projectId: string): EditorController {
  const [appSettings] = useAppSettings();
  const historyDepthRef = useRef(appSettings.historyDepth);
  historyDepthRef.current = appSettings.historyDepth;
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [pdfMissing, setPdfMissing] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [textEditing, setTextEditing] = useState(false);
  const [bootEncodedPng, setBootEncodedPng] = useState<ReadonlyMap<string, ArrayBuffer>>(new Map());
  const [inkFrame, setInkFrame] = useState(0);
  const inkFrameRafRef = useRef(0);
  const [marqueePreview, setMarqueePreview] = useState<MarqueePreview | null>(null);
  const marqueeRafRef = useRef(0);
  const pendingMarqueeRef = useRef<MarqueePreview | null>(null);
  const [lassoPreview, setLassoPreview] = useState<LassoPreview | null>(null);
  const lassoRafRef = useRef(0);
  const pendingLassoRef = useRef<LassoPreview | null>(null);
  const clipLiveRef = useRef<Map<string, ClipLiveTransform>>(new Map());
  const selectionMoveRef = useRef<{
    clips: Array<{ clipId: ClipId; x: number; y: number }>;
    texts: Array<{
      textId: TextId;
      x: number;
      y: number;
      width: number;
      height: number;
      fontSize: number;
      where: 'page' | 'pasteboard';
      pageId?: PageId;
      worldX: number;
      worldY: number;
    }>;
  } | null>(null);
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
  const inkUndoRef = useRef<Map<string, InkUndoPixels>>(new Map());
  const pendingInkHistoryRef = useRef<PendingInkHistoryItem[]>([]);
  const idleInkFlushRef = useRef<() => Promise<void>>(async () => {});
  const inkIdleScheduler = useMemo(
    () =>
      createInkIdleAutosaveScheduler(() => {
        void idleInkFlushRef.current();
      }, getInkIdleMs),
    [],
  );
  const historyRef = useRef<EditorHistory | null>(null);
  useEffect(() => {
    setHistory((prev) => (prev ? trimEditorHistoryDepth(prev, appSettings.historyDepth) : prev));
  }, [appSettings.historyDepth]);
  const textEditingRef = useRef(false);
  const textSelectionRef = useRef<TextEditSelection | null>(null);
  const textDraftRef = useRef<string | null>(null);
  const checkpointBeforeHeavyWorkRef = useRef<(() => Promise<void>) | null>(null);
  const createTextAtPointer = useCallback((pending: PendingCreate) => {
    if (!Number.isFinite(pending.x) || !Number.isFinite(pending.y)) {
      return;
    }
    const present = historyRef.current?.present;
    if (!present) {
      return;
    }
    const rasterBox = defaultTextBox(
      present.rasterWidth,
      present.rasterHeight,
      present.tools.textFontSize,
      present.tools.textWritingMode,
    );
    const pasteboard = 'pasteboard' in pending && pending.pasteboard;
    const width = pasteboard
      ? rasterBox.width * (PAGE_DISPLAY_W / Math.max(1, present.rasterWidth))
      : rasterBox.width;
    const height = pasteboard
      ? rasterBox.height * (PAGE_DISPLAY_H / Math.max(1, present.rasterHeight))
      : rasterBox.height;
    const origin = pasteboard
      ? { x: pending.x - width / 2, y: pending.y - height / 2 }
      : clampTextBoxOrigin(
          pending.x - width / 2,
          pending.y - height / 2,
          width,
          height,
          present.rasterWidth,
          present.rasterHeight,
        );
    const pendingInkUndo = takePendingInkUndo(inkUndoRef.current);
    setHistory((prev) => {
      if (!prev) {
        return prev;
      }
      const action: EditorDocumentAction = pasteboard
        ? {
            type: 'createText',
            attachment: { kind: 'pasteboard' },
            box: { x: origin.x, y: origin.y, width, height },
          }
        : {
            type: 'createText',
            attachment: { kind: 'page', pageId: pending.pageId },
            box: { x: origin.x, y: origin.y, width, height },
          };
      const nextPresent = reduceEditorDocument(prev.present, action, randomId);
      const nextHistory = pushEditorHistory(prev, nextPresent, pendingInkUndo, false, historyDepthRef.current);
      autosaveRef.current?.scheduleSave(nextHistory.present, [], false);
      return nextHistory;
    });
  }, []);
  const templateImageRef = useRef<HTMLImageElement | null>(null);
  const inkApiRef = useRef<InkEngineApi | null>(null);
  const lastLiveInkRef = useRef(new Map<string, StrokePoint>());
  const extractPackRef = useRef<ExtractPackCursor | null>(null);
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

  const scheduleLassoPreview = useCallback((preview: LassoPreview | null) => {
    pendingLassoRef.current = preview;
    if (lassoRafRef.current) {
      return;
    }
    lassoRafRef.current = requestAnimationFrame(() => {
      lassoRafRef.current = 0;
      setLassoPreview(pendingLassoRef.current);
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
      inkIdleScheduler.cancel();
      if (inkFrameRafRef.current) {
        cancelAnimationFrame(inkFrameRafRef.current);
      }
      if (marqueeRafRef.current) {
        cancelAnimationFrame(marqueeRafRef.current);
      }
      if (lassoRafRef.current) {
        cancelAnimationFrame(lassoRafRef.current);
      }
      if (clipDragRafRef.current) {
        cancelAnimationFrame(clipDragRafRef.current);
      }
    };
  }, [inkIdleScheduler]);

  const emptyPng = useMemo(() => copySharedTransparentPng(), []);

  const drawTemplate = useCallback<DrawTemplate>((ctx, width, height) => {
    const img = templateImageRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, width, height);
    }
  }, []);

  const rasterIdsKey = history ? documentRasterIdsKey(history.present) : '';

  const rasterIds = useMemo(
    () => (history ? collectRasterIds(history.present) : []),
    [history, rasterIdsKey],
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
  textEditingRef.current = textEditing;
  textSelectionRef.current = textSelection;

  useEffect(() => {
    const img = new Image();
    img.src = publicUrl('/page_template.jpg');
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
        hardNavigate(publicUrl('/'), 'replace');
        return;
      }

      encodedPngRef.current = new Map(boot.encodedPng);
      setBootEncodedPng(new Map(boot.encodedPng));
      setPdfMissing(boot.pdfMissing);
      setPdfBytes(boot.pdfFile ? await boot.pdfFile.arrayBuffer() : null);
      const restored = applyPdfViewSession(boot.document, loadPdfViewSession(projectId));
      setHistory(editorHistoryFromBoot({ ...boot, document: restored }));

      autosaveRef.current = new AutosaveManager({
        getEncodedPng: () => {
          const merged = new Map(encodedPngRef.current);
          const engine = inkApiRef.current?.engine;
          if (engine) {
            for (const [rasterId, png] of engine.encodedPng) {
              if (png.byteLength > 0) {
                merged.set(rasterId, png);
              }
            }
          }
          return merged;
        },
        onStatusChange: setAutosaveStatus,
        getDelays: getAutosaveDelays,
      });

      setReady(true);
    })();

    return () => {
      cancelled = true;
      const autosave = autosaveRef.current;
      autosaveRef.current = null;
      if (autosave) {
        void (async () => {
          try {
            await checkpointBeforeHeavyWorkRef.current?.();
          } catch {
            // unmount fallback is best-effort
          } finally {
            autosave.dispose();
          }
        })();
      }
    };
  }, [projectId]);

  useEffect(() => {
    const flushHidden = () => {
      if (isDefaultStorageReleased()) {
        return;
      }
      inkIdleScheduler.cancel();
      inkApiRef.current?.engine.flushPendingEncodes();
      const engine = inkApiRef.current?.engine;
      if (engine) {
        for (const [rasterId, png] of engine.encodedPng) {
          if (png.byteLength > 0) {
            encodedPngRef.current.set(rasterId, png);
          }
        }
      }
      const pending = pendingInkHistoryRef.current;
      if (pending.length > 0) {
        pendingInkHistoryRef.current = [];
        setHistory((prev) => {
          if (!prev) {
            pendingInkHistoryRef.current = pending.concat(pendingInkHistoryRef.current);
            return prev;
          }
          const history = consumePendingInkHistory(prev, pending);
          autosaveRef.current?.scheduleSave(history.present, collectRasterIds(history.present), false);
          return history;
        });
      } else {
        const present = historyRef.current?.present;
        if (present) {
          autosaveRef.current?.scheduleSave(present, collectRasterIds(present), false);
        }
      }
      autosaveRef.current?.flushHidden();
      void autosaveRef.current?.flushRouteLeave();
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

    const onPageHide = () => {
      // #region agent log
      ipadDebugLog({
        sessionId: 'adcc47',
        ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
        hypothesisId: 'F',
        location: 'useEditorController.ts:pagehide',
        message: 'pagehide flush after possible close',
      });
      // #endregion
      flushHidden();
      releaseDefaultStorageDatabase();
    };

    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', flushHidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', flushHidden);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [inkIdleScheduler]);

  const persist = useCallback((nextHistory: EditorHistory, viewOnly: boolean, dirtyRasterIds: string[], skipSchedule = false) => {
    const dirty = viewOnly ? [] : dirtyRasterIds;
    const engine = inkApiRef.current?.engine;
    if (engine) {
      for (const [rasterId, png] of engine.encodedPng) {
        if (png.byteLength > 0) {
          encodedPngRef.current.set(rasterId, png);
        }
      }
    }
    if (skipSchedule) {
      autosaveRef.current?.updatePendingDocument?.(nextHistory.present);
    } else {
      autosaveRef.current?.scheduleSave(nextHistory.present, dirty, viewOnly);
    }
    const pdf = nextHistory.present.pdf;
    if (pdf) {
      savePdfViewSession(projectId, {
        currentPage: pdf.currentPage,
        zoom: pdf.zoom,
        panX: pdf.panX,
        panY: pdf.panY,
        fingerprint: pdf.sourceFingerprint,
      });
    }
  }, [projectId]);

  const dispatch = useCallback(
    (action: EditorDocumentAction) => {
      const viewOnly = isViewOnlyHistoryAction(action.type);
      let pendingInkUndo: Map<string, InkUndoPixels> | undefined;
      setHistory((prev) => {
        if (!prev) {
          return prev;
        }
        if (action.type === 'setWorkspaceView') {
          const prevView = prev.present;
          if (
            prevView.workspaceZoom !== action.zoom ||
            prevView.workspacePanX !== action.panX ||
            prevView.workspacePanY !== action.panY
          ) {
            extractPackRef.current = null;
          }
        }
        const nextPresent = reduceEditorDocument(prev.present, action, randomId);
        if (nextPresent === prev.present) {
          return prev;
        }
        if (!viewOnly && pendingInkUndo === undefined) {
          pendingInkUndo = takePendingInkUndo(inkUndoRef.current);
        }
        const inkForHistory = viewOnly ? new Map<string, InkUndoPixels>() : (pendingInkUndo ?? new Map());
        const nextHistory = pushEditorHistory(prev, nextPresent, inkForHistory, viewOnly, historyDepthRef.current);
        persist(
          nextHistory,
          viewOnly,
          dirtyRasterIdsForAction(prev.present, nextPresent, action),
          action.type === 'setToolProperties',
        );
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

  const bakeClipOntoPage = useCallback(
    (clipId: string, present: EditorDocument) => {
      const api = inkApiRef.current;
      if (!api) {
        return;
      }
      const clip = present.pasteboardClips.find((c) => c.id === clipId);
      if (!clip) {
        return;
      }
      const frames = buildStripFrames(present.workspaceOrder, stripLayoutFromDoc(present)).frames;
      const pose = effectiveClipPose(clip, clipLiveRef.current.get(clipId));
      const target = clipInsertTarget(
        { ...clip, ...pose },
        api.engine.getRasterDimensions(clip.rasterId),
        present.rasterWidth,
        present.rasterHeight,
        frames,
      );
      if (!target) {
        dispatch({
          type: 'transformClip',
          clipId,
          x: pose.x,
          y: pose.y,
          scale: pose.scale,
          scaleY: pose.scaleY,
          rotation: pose.rotation,
        });
        clipLiveRef.current.delete(clipId);
        bumpClipDragFrame();
        return;
      }
      const page = present.pages[target.pageId];
      const frame = frameForPage(present.workspaceOrder, target.pageId, frames);
      if (!page || !frame) {
        return;
      }
      const local = pageLocalFromWorld(
        frame,
        pose.x,
        pose.y,
        present.rasterWidth,
        present.rasterHeight,
      );
      const { pageUndo, clipUndo } = api.engine.bakeClipOntoPage(
        page.rasterId,
        clip.rasterId,
        local.x,
        local.y,
        pose.scale,
        pose.rotation,
        pose.scaleY,
      );
      stashInkUndo(inkUndoRef.current, page.rasterId, pageUndo);
      stashInkUndo(inkUndoRef.current, clip.rasterId, clipUndo);
      dispatch({ type: 'commitClipBake', clipId, pageId: target.pageId });
      clipLiveRef.current.delete(clipId);
      bumpClipDragFrame();
      bumpInkFrame();
    },
    [bumpClipDragFrame, bumpInkFrame, dispatch],
  );

  const applyClipEffects = useCallback(
    (effects: WorkspaceEffect[], present: EditorDocument) => {
      const api = inkApiRef.current;
      if (!api) {
        return;
      }
      const frames = buildStripFrames(present.workspaceOrder, stripLayoutFromDoc(present)).frames;

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
          if (present.tool === 'scissors') {
            const worldRect = effect.rect;
            const result = finishScissorsGesture({
              present,
              engine: api.engine,
              live: clipLiveRef.current,
              frames,
              worldPoints: [
                { x: worldRect.x, y: worldRect.y },
                { x: worldRect.x + worldRect.width, y: worldRect.y },
                { x: worldRect.x + worldRect.width, y: worldRect.y + worldRect.height },
                { x: worldRect.x, y: worldRect.y + worldRect.height },
              ],
              worldRect,
              mode: 'marquee',
              originPageId: effect.pageId,
              inkUndo: inkUndoRef.current,
              dispatch,
            });
            if (result.clipIds.length > 0) {
              bumpInkFrame();
            }
            continue;
          }
          const targets =
            present.tool === 'text'
              ? { text: true, ink: false, clip: false }
              : selectTargetFlagsOf(present.tools);
          const worldRect = effect.rect;
          const textIdsInRect = targets.text
            ? collectTextIdsInWorldRect(present, frames, worldRect)
            : [];
          const clipIdsInRect = targets.clip
            ? present.pasteboardClips
                .filter((clip) => !stockedClipIds(present.stock).has(clip.id))
                .filter((clip) => !(present.trashClips ?? []).includes(clip.id))
                .filter((clip) => {
                  const pose = effectiveClipPose(clip, clipLiveRef.current.get(clip.id));
                  return clipTouchesWorldRect(
                    { ...clip, ...pose },
                    api.engine.getRasterDimensions(clip.rasterId),
                    present.rasterWidth,
                    present.rasterHeight,
                    worldRect,
                  );
                })
                .map((clip) => clip.id)
            : [];
          const cutClipIds: string[] = [];
          let lastCutPageId: string | null = null;
          if (targets.ink) {
            for (const frame of frames) {
              if (frame.slot.kind !== 'page') {
                continue;
              }
              const page = present.pages[frame.slot.pageId];
              if (!page) {
                continue;
              }
              const localRect = worldRectToPageLocalRect(
                frame,
                worldRect,
                present.rasterWidth,
                present.rasterHeight,
              );
              if (
                !localRect ||
                localRect.width < MIN_MARQUEE_RASTER_PX ||
                localRect.height < MIN_MARQUEE_RASTER_PX
              ) {
                continue;
              }
              const clipId = randomId();
              const rasterId = `${present.projectId}:clip:${clipId}`;
              const cut = api.engine.marqueeCut(page.rasterId, rasterId, localRect);
              if (!cut.trim) {
                continue;
              }
              const trimmedRect = {
                x: localRect.x + cut.trim.x,
                y: localRect.y + cut.trim.y,
                width: cut.trim.width,
                height: cut.trim.height,
              };
              const world = pageLocalRectToWorld(
                frame.x,
                frame.y,
                frame.width,
                frame.height,
                trimmedRect,
                present.rasterWidth,
                present.rasterHeight,
              );
              stashInkUndo(inkUndoRef.current, page.rasterId, cut.pageUndo);
              dispatch({
                type: 'commitMarqueeCut',
                pageId: frame.slot.pageId,
                clipId,
                rasterId,
                workspaceX: world.x,
                workspaceY: world.y,
              });
              cutClipIds.push(clipId);
              lastCutPageId = frame.slot.pageId;
            }
            if (cutClipIds.length > 0) {
              bumpInkFrame();
            }
          }
          focusWorkspacePageIfNeeded(dispatch, effect.pageId, lastCutPageId);
          if (targets.clip || cutClipIds.length > 0) {
            dispatch({ type: 'selectClips', clipIds: [...clipIdsInRect, ...cutClipIds] });
          }
          if (targets.text) {
            dispatch({ type: 'selectTexts', textIds: textIdsInRect });
          }
          continue;
        }
        if (effect.type === 'lassoPreview') {
          scheduleLassoPreview({ points: effect.points });
          continue;
        }
        if (effect.type === 'completeLasso') {
          pendingLassoRef.current = null;
          if (lassoRafRef.current) {
            cancelAnimationFrame(lassoRafRef.current);
            lassoRafRef.current = 0;
          }
          setLassoPreview(null);
          const worldAabb = polygonAabb(effect.points);
          if (
            !worldAabb ||
            worldAabb.width < MIN_MARQUEE_RASTER_PX ||
            worldAabb.height < MIN_MARQUEE_RASTER_PX
          ) {
            continue;
          }
          if (present.tool === 'scissors') {
            const result = finishScissorsGesture({
              present,
              engine: api.engine,
              live: clipLiveRef.current,
              frames,
              worldPoints: effect.points,
              worldRect: worldAabb,
              mode: 'lasso',
              originPageId: effect.originPageId,
              inkUndo: inkUndoRef.current,
              dispatch,
            });
            if (result.clipIds.length > 0) {
              bumpInkFrame();
            }
            continue;
          }
          const targets = selectTargetFlagsOf(present.tools);
          const textIdsInPoly = targets.text
            ? collectTextIdsInWorldPolygon(present, frames, effect.points)
            : [];
          const clipIdsInPoly = targets.clip
            ? present.pasteboardClips
                .filter((clip) => !stockedClipIds(present.stock).has(clip.id))
                .filter((clip) => !(present.trashClips ?? []).includes(clip.id))
                .filter((clip) => {
                  const pose = effectiveClipPose(clip, clipLiveRef.current.get(clip.id));
                  return clipTouchesPolygon(
                    { ...clip, ...pose },
                    api.engine.getRasterDimensions(clip.rasterId),
                    present.rasterWidth,
                    present.rasterHeight,
                    effect.points,
                  );
                })
                .map((clip) => clip.id)
            : [];
          const cutClipIds: string[] = [];
          let lastCutPageId: string | null = null;
          if (targets.ink) {
            for (const frame of frames) {
              if (frame.slot.kind !== 'page') {
                continue;
              }
              const page = present.pages[frame.slot.pageId];
              if (!page) {
                continue;
              }
              const localPoints = worldPointsToPageLocal(
                frame,
                effect.points,
                present.rasterWidth,
                present.rasterHeight,
              );
              const localAabb = polygonAabb(localPoints);
              if (!localAabb) {
                continue;
              }
              const padded = {
                x: localAabb.x - 1,
                y: localAabb.y - 1,
                width: localAabb.width + 2,
                height: localAabb.height + 2,
              };
              const localRect = intersectRects(padded, {
                x: 0,
                y: 0,
                width: present.rasterWidth,
                height: present.rasterHeight,
              });
              if (
                !localRect ||
                localRect.width < MIN_MARQUEE_RASTER_PX ||
                localRect.height < MIN_MARQUEE_RASTER_PX
              ) {
                continue;
              }
              const clipId = randomId();
              const rasterId = `${present.projectId}:clip:${clipId}`;
              const cut = api.engine.lassoCut(page.rasterId, rasterId, localPoints, localRect);
              if (!cut.trim) {
                continue;
              }
              const trimmedRect = {
                x: localRect.x + cut.trim.x,
                y: localRect.y + cut.trim.y,
                width: cut.trim.width,
                height: cut.trim.height,
              };
              const world = pageLocalRectToWorld(
                frame.x,
                frame.y,
                frame.width,
                frame.height,
                trimmedRect,
                present.rasterWidth,
                present.rasterHeight,
              );
              stashInkUndo(inkUndoRef.current, page.rasterId, cut.pageUndo);
              dispatch({
                type: 'commitMarqueeCut',
                pageId: frame.slot.pageId,
                clipId,
                rasterId,
                workspaceX: world.x,
                workspaceY: world.y,
              });
              cutClipIds.push(clipId);
              lastCutPageId = frame.slot.pageId;
            }
            if (cutClipIds.length > 0) {
              bumpInkFrame();
            }
          }
          focusWorkspacePageIfNeeded(dispatch, effect.originPageId, lastCutPageId);
          if (targets.clip || cutClipIds.length > 0) {
            dispatch({ type: 'selectClips', clipIds: [...clipIdsInPoly, ...cutClipIds] });
          }
          if (targets.text) {
            dispatch({ type: 'selectTexts', textIds: textIdsInPoly });
          }
          continue;
        }
        if (effect.type === 'dropClipOnPage') {
          bakeClipOntoPage(effect.clipId, present);
        }
      }
    },
    [bakeClipOntoPage, bumpInkFrame, dispatch, scheduleLassoPreview, scheduleMarqueePreview],
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
              scaleY: live.scaleY,
              rotation: live.rotation,
            });
          }
          changed = true;
          continue;
        }
        if (effect.type === 'cancelClipTransform') {
          clipLiveRef.current.delete(effect.clipId);
          changed = true;
        }
        if (effect.type === 'beginSelectionMove') {
          const frames = buildStripFrames(present.workspaceOrder, stripLayoutFromDoc(present)).frames;
          selectionMoveRef.current = {
            clips: effect.clipIds.flatMap((clipId) => {
              const clip = present.pasteboardClips.find((item) => item.id === clipId);
              return clip ? [{ clipId, x: clip.x, y: clip.y }] : [];
            }),
            texts: effect.textIds.flatMap((textId) => {
              const found = findText(present, textId);
              if (!found) {
                return [];
              }
              const world = textWorldBox({
                where: found.where,
                pageId: found.pageId,
                box: found.node.box,
                frames,
                rasterWidth: present.rasterWidth,
                rasterHeight: present.rasterHeight,
              });
              return [
                {
                  textId,
                  x: found.node.box.x,
                  y: found.node.box.y,
                  width: found.node.box.width,
                  height: found.node.box.height,
                  fontSize: found.node.fontSize,
                  where: found.where,
                  pageId: found.pageId,
                  worldX: world.x,
                  worldY: world.y,
                },
              ];
            }),
          };
          changed = true;
          continue;
        }
        if (effect.type === 'selectionMoveLive') {
          const snapshot = selectionMoveRef.current;
          if (!snapshot) {
            continue;
          }
          const frames = buildStripFrames(present.workspaceOrder, stripLayoutFromDoc(present)).frames;
          for (const clipStart of snapshot.clips) {
            const clip = present.pasteboardClips.find((item) => item.id === clipStart.clipId);
            if (!clip) {
              continue;
            }
            clipLiveRef.current.set(
              clipStart.clipId,
              mergeClipLive(clip, clipLiveRef.current.get(clipStart.clipId), {
                x: clipStart.x + effect.dx,
                y: clipStart.y + effect.dy,
              }),
            );
          }
          for (const textStart of snapshot.texts) {
            const found = findText(present, textStart.textId);
            if (!found) {
              continue;
            }
            const pose = textPoseAfterWorldMove({
              sourceWhere: textStart.where,
              sourcePageId: textStart.pageId,
              sourceBox: {
                x: textStart.x,
                y: textStart.y,
                width: textStart.width,
                height: textStart.height,
              },
              sourceFontSize: textStart.fontSize,
              worldX: textStart.worldX + effect.dx,
              worldY: textStart.worldY + effect.dy,
              frames,
              rasterWidth: present.rasterWidth,
              rasterHeight: present.rasterHeight,
            });
            const box =
              pose.attachment.kind === 'page'
                ? {
                    ...pose.box,
                    ...clampTextBoxOrigin(
                      pose.box.x,
                      pose.box.y,
                      pose.box.width,
                      pose.box.height,
                      present.rasterWidth,
                      present.rasterHeight,
                    ),
                  }
                : pose.box;
            textLiveRef.current.set(
              textStart.textId,
              mergeTextLive(found.node.box, textLiveRef.current.get(textStart.textId), {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                where: pose.attachment.kind === 'pasteboard' ? 'pasteboard' : 'page',
                pageId: pose.attachment.kind === 'page' ? pose.attachment.pageId : undefined,
              }),
            );
          }
          changed = true;
          continue;
        }
        if (effect.type === 'commitSelectionMove') {
          const snapshot = selectionMoveRef.current;
          selectionMoveRef.current = null;
          const clips: Array<{ clipId: ClipId; x: number; y: number }> = [];
          const texts: Array<{
            textId: TextId;
            x: number;
            y: number;
            width?: number;
            height?: number;
            fontSize?: number;
            attachment?: { kind: 'page'; pageId: PageId } | { kind: 'pasteboard' };
          }> = [];
          if (snapshot) {
            for (const clipStart of snapshot.clips) {
              const live = clipLiveRef.current.get(clipStart.clipId);
              clipLiveRef.current.delete(clipStart.clipId);
              if (live) {
                clips.push({ clipId: clipStart.clipId, x: live.x, y: live.y });
              }
            }
            for (const textStart of snapshot.texts) {
              const live = textLiveRef.current.get(textStart.textId);
              textLiveRef.current.delete(textStart.textId);
              if (!live) {
                continue;
              }
              const liveWidth = live.width ?? textStart.width;
              const liveHeight = live.height ?? textStart.height;
              const where = live.where ?? textStart.where;
              const pageId = live.pageId ?? textStart.pageId;
              const crossed = where !== textStart.where;
              texts.push({
                textId: textStart.textId,
                x: live.x,
                y: live.y,
                width: liveWidth,
                height: liveHeight,
                fontSize: crossed
                  ? textStart.fontSize
                  : textStart.fontSize * (liveWidth / Math.max(1, textStart.width)),
                attachment:
                  where === 'pasteboard'
                    ? { kind: 'pasteboard' }
                    : pageId
                      ? { kind: 'page', pageId }
                      : undefined,
              });
            }
          }
          if (clips.length > 0 || texts.length > 0) {
            dispatch({ type: 'moveSelection', clips, texts });
          }
          changed = true;
          continue;
        }
        if (effect.type === 'cancelSelectionMove') {
          const snapshot = selectionMoveRef.current;
          selectionMoveRef.current = null;
          if (snapshot) {
            for (const clipStart of snapshot.clips) {
              clipLiveRef.current.delete(clipStart.clipId);
            }
            for (const textStart of snapshot.texts) {
              textLiveRef.current.delete(textStart.textId);
            }
          }
          changed = true;
        }
      }
      if (changed) {
        bumpClipDragFrame();
        bumpTextDragFrame();
      }
    },
    [bumpClipDragFrame, bumpTextDragFrame, dispatch],
  );

  const applyTextLiveEffects = useCallback(
    (effects: WorkspaceEffect[], present: EditorDocument) => {
      const frames = buildStripFrames(present.workspaceOrder, stripLayoutFromDoc(present)).frames;
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
        if (effect.type === 'textResizeLive') {
          const found = findText(present, effect.textId);
          if (!found) continue;
          const box = sanitizeTextBox(effect.box);
          textLiveRef.current.set(
            effect.textId,
            mergeTextLive(found.node.box, textLiveRef.current.get(effect.textId), {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              pageId: found.pageId,
              where: found.where,
            }),
          );
          changed = true;
          continue;
        }
        if (effect.type === 'commitTextResize') {
          textLiveRef.current.delete(effect.textId);
          dispatch({ type: 'resizeText', textId: effect.textId, box: sanitizeTextBox(effect.box) });
          changed = true;
          continue;
        }
        if (effect.type === 'textTransformLive') {
          if (!Number.isFinite(effect.x) || !Number.isFinite(effect.y)) {
            continue;
          }
          const found = findText(present, effect.textId);
          if (!found) {
            continue;
          }
          const targetPageId = effect.pasteboard ? undefined : (effect.pageId ?? found.pageId);
          const targetBox = textBoxForOwnerMove({
            sourceWhere: found.where,
            sourcePageId: found.pageId,
            sourceBox: found.node.box,
            x: effect.x,
            y: effect.y,
            targetPasteboard: Boolean(effect.pasteboard),
            targetPageId,
            frameForPageId: (pageId) => frameForPage(present.workspaceOrder, pageId, frames),
            rasterWidth: present.rasterWidth,
            rasterHeight: present.rasterHeight,
          });
          const clamped = clampOnPage(targetPageId, targetBox);
          const next = mergeTextLive(found.node.box, textLiveRef.current.get(effect.textId), {
            x: clamped.x,
            y: clamped.y,
            width: clamped.width,
            height: clamped.height,
            pageId: effect.pageId,
            where: effect.pasteboard ? 'pasteboard' : 'page',
          });
          textLiveRef.current.set(effect.textId, next);
          changed = true;
          continue;
        }
        if (effect.type === 'commitTextTransform') {
          textLiveRef.current.delete(effect.textId);
          const found = findText(present, effect.textId);
          if (found && Number.isFinite(effect.x) && Number.isFinite(effect.y)) {
            const targetPageId = effect.pasteboard ? undefined : (effect.pageId ?? found.pageId);
            const targetBox = textBoxForOwnerMove({
              sourceWhere: found.where,
              sourcePageId: found.pageId,
              sourceBox: found.node.box,
              x: effect.x,
              y: effect.y,
              targetPasteboard: Boolean(effect.pasteboard),
              targetPageId,
              frameForPageId: (pageId) => frameForPage(present.workspaceOrder, pageId, frames),
              rasterWidth: present.rasterWidth,
              rasterHeight: present.rasterHeight,
            });
            const clamped = clampOnPage(targetPageId, targetBox);
            if (effect.pasteboard && found.where === 'page' && found.pageId) {
              dispatch({
                type: 'detachTextToPasteboard',
                textId: effect.textId,
                workspaceBox: clamped,
                fontSize: found.node.fontSize,
              });
            } else if (
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
                pageBox: clamped,
                fontSize: found.node.fontSize,
              });
            } else {
              dispatch({ type: 'moveText', textId: effect.textId, x: clamped.x, y: clamped.y });
            }
          }
          changed = true;
          continue;
        }
        if (effect.type === 'cancelTextTransform' || effect.type === 'cancelTextResize') {
          textLiveRef.current.delete(effect.textId);
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
    (rasterId: string, undo: InkUndoPixels) => {
      stashInkUndo(inkUndoRef.current, rasterId, undo);
      dispatch({ type: 'commitInkBake', rasterId });
      bumpInkFrame();
    },
    [bumpInkFrame, dispatch],
  );

  const clearPageInk = useCallback(
    (pageId: PageId) => {
      const present = historyRef.current?.present;
      const api = inkApiRef.current;
      if (!present || !api) {
        return;
      }
      const page = present.pages[pageId];
      if (!page) {
        return;
      }
      stashInkUndo(inkUndoRef.current, page.rasterId, api.engine.clearRaster(page.rasterId));
      dispatch({ type: 'commitInkBake', rasterId: page.rasterId });
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
            inkIdleScheduler.cancel();
            const ctx = api.beginPenOverlay(rasterId);
            const point: StrokePoint = { x: effect.x, y: effect.y, pressure: effect.pressure };
            const last = appendLiveBrushStroke(ctx, null, [point], (p) =>
              inkStrokeStyle(present, p.pressure, false),
            );
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
              (p) => inkStrokeStyle(present, p.pressure, false),
            );
            if (last) {
              lastLiveInkRef.current.set(rasterId, last);
            }
            visualBump = true;
            break;
          }
          case 'commitPenOverlay': {
            lastLiveInkRef.current.delete(rasterId);
            api.engine.blitPenOverlay(rasterId);
            const drained = api.engine.drainPendingBakeWork(1, { encode: false });
            for (const item of drained) {
              pendingInkHistoryRef.current.push(item);
            }
            autosaveRef.current?.markUnsaved();
            inkIdleScheduler.schedule();
            visualBump = true;
            break;
          }
          case 'beginEraseDirect': {
            inkIdleScheduler.cancel();
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
              (p) => inkStrokeStyle(present, p.pressure, true),
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
            inkIdleScheduler.schedule();
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
          if (
            effects.some(
              (effect) =>
                (effect.type === 'penOverlayMove' || effect.type === 'eraseDirectMove') &&
                rasterIdForInkEffect(present, effect) === rasterId,
            ) &&
            !effects.some(
              (effect) =>
                (effect.type === 'commitPenOverlay' || effect.type === 'commitEraseDirect') &&
                rasterIdForInkEffect(present, effect) === rasterId,
            )
          ) {
            scheduleInkDisplay(rasterId);
          } else {
            repaintInkDisplay(rasterId);
          }
        }
        if (effects.some((effect) => effect.type === 'commitEraseDirect')) {
          bumpInkFrame();
        }
      }
    },
    [bumpInkFrame, commitInkBake, inkIdleScheduler],
  );

  const deleteText = useCallback(
    (textId: string) => {
      const present = historyRef.current?.present;
      const selectedTexts = present ? selectedTextIdsOf(present) : [];
      const selectedClips = present ? selectedClipIdsOf(present) : [];
      const textIds = selectedTexts.includes(textId) ? selectedTexts : [textId];
      const clipIds = selectedTexts.includes(textId) ? selectedClips : [];
      for (const id of textIds) {
        textLiveRef.current.delete(id);
      }
      setTextLiveTransforms(Object.fromEntries(textLiveRef.current));
      if (textIds.length + clipIds.length > 1) {
        for (const id of clipIds) {
          clipLiveRef.current.delete(id);
        }
        bumpClipDragFrame();
        dispatch({ type: 'deleteSelection', textIds, clipIds });
        return;
      }
      dispatch({ type: 'deleteText', textId });
    },
    [bumpClipDragFrame, dispatch],
  );

  const lastTextDuplicateAtRef = useRef(0);
  const duplicateText = useCallback(
    (textId: string) => {
      const now = Date.now();
      if (now - lastTextDuplicateAtRef.current < 450) {
        return;
      }
      lastTextDuplicateAtRef.current = now;
      const present = historyRef.current?.present;
      const selectedTexts = present ? selectedTextIdsOf(present) : [];
      const textIds = selectedTexts.includes(textId) ? selectedTexts : [textId];
      dispatch({ type: 'duplicateText', textIds });
      if (textIds.length <= 1) {
        setTextEditing(true);
      }
    },
    [dispatch],
  );

  const deleteClip = useCallback(
    (clipId: string) => {
      const present = historyRef.current?.present;
      const selected = present ? selectedClipIdsOf(present) : [];
      const selectedTexts = present ? selectedTextIdsOf(present) : [];
      const ids = selected.includes(clipId) ? selected : [clipId];
      const textIds = selected.includes(clipId) ? selectedTexts : [];
      for (const id of ids) {
        clipLiveRef.current.delete(id);
      }
      bumpClipDragFrame();
      if (ids.length + textIds.length > 1) {
        for (const id of textIds) {
          textLiveRef.current.delete(id);
        }
        setTextLiveTransforms(Object.fromEntries(textLiveRef.current));
        dispatch({ type: 'deleteSelection', textIds, clipIds: ids });
        return;
      }
      dispatch({ type: 'deleteClip', clipIds: ids });
    },
    [bumpClipDragFrame, dispatch],
  );

  const duplicateClip = useCallback(
    (clipId: string) => {
      const present = historyRef.current?.present;
      const api = inkApiRef.current;
      if (!present || !api) {
        return;
      }
      const selected = selectedClipIdsOf(present);
      const sourceIds = selected.includes(clipId) ? selected : [clipId];
      const textIds = selected.includes(clipId) ? selectedTextIdsOf(present) : [];
      const clonedClipIds: string[] = [];
      for (const sourceId of sourceIds) {
        const source = present.pasteboardClips.find((c) => c.id === sourceId);
        if (!source) {
          continue;
        }
        const pose = effectiveClipPose(source, clipLiveRef.current.get(sourceId));
        const nextClipId = randomId();
        const nextRasterId = clipRasterId(present.projectId, nextClipId);
        if (!api.engine.duplicateRaster(source.rasterId, nextRasterId)) {
          continue;
        }
        dispatch({
          type: 'duplicateClip',
          sourceClipId: sourceId,
          clipId: nextClipId,
          rasterId: nextRasterId,
          x: pose.x + CLIP_DUPLICATE_OFFSET,
          y: pose.y + CLIP_DUPLICATE_OFFSET,
          scale: pose.scale,
          scaleY: pose.scaleY,
          rotation: pose.rotation,
        });
        clonedClipIds.push(nextClipId);
      }
      if (textIds.length > 0) {
        dispatch({ type: 'duplicateText', textIds });
      }
      if (clonedClipIds.length > 1) {
        dispatch({ type: 'selectClips', clipIds: clonedClipIds });
      }
      if (clonedClipIds.length > 0) {
        bumpInkFrame();
      }
    },
    [bumpInkFrame, dispatch],
  );

  const insertClipOnPage = useCallback(
    (clipId: string) => {
      const present = historyRef.current?.present;
      if (!present) {
        return;
      }
      const selected = selectedClipIdsOf(present);
      const ids = selected.includes(clipId) ? selected : [clipId];
      for (const id of ids) {
        bakeClipOntoPage(id, present);
      }
    },
    [bakeClipOntoPage],
  );

  const mergeSelectedClips = useCallback(
    (clipId: string) => {
      const present = historyRef.current?.present;
      const api = inkApiRef.current;
      if (!present || !api) {
        return;
      }
      const selected = selectedClipIdsOf(present);
      const requested = selected.includes(clipId) ? selected : [clipId];
      const visible = new Set(eligibleScissorsClips(present).map((clip) => clip.id));
      const ordered = present.pasteboardClips.filter((clip) => requested.includes(clip.id) && visible.has(clip.id));
      if (ordered.length < 2) {
        return;
      }
      const layoutClips = ordered.map((clip) => {
        const pose = effectiveClipPose(clip, clipLiveRef.current.get(clip.id));
        return {
          clip: { ...clip, ...pose },
          size: api.engine.getRasterDimensions(clip.rasterId),
        };
      });
      const layout = clipMergeLayout(layoutClips, present.rasterWidth, present.rasterHeight);
      if (!layout) {
        return;
      }
      const nextClipId = randomId();
      const nextRasterId = clipRasterId(present.projectId, nextClipId);
      const merged = api.engine.mergeClipsOntoRaster(
        nextRasterId,
        layout.destWidth,
        layout.destHeight,
        ordered.map((clip, index) => {
          const pose = layoutClips[index]!.clip;
          const origin = layout.sources[index]!;
          return {
            rasterId: clip.rasterId,
            destLocalX: origin.destLocalX,
            destLocalY: origin.destLocalY,
            scale: pose.scale,
            rotation: pose.rotation,
            scaleY: pose.scaleY,
          };
        }),
      );
      if (!merged.trim) {
        return;
      }
      for (const clip of ordered) {
        clipLiveRef.current.delete(clip.id);
      }
      bumpClipDragFrame();
      dispatch({
        type: 'commitClipMerge',
        sourceClipIds: ordered.map((clip) => clip.id),
        clipId: nextClipId,
        rasterId: nextRasterId,
        x: layout.aabb.minX + merged.trim.x * layout.sx,
        y: layout.aabb.minY + merged.trim.y * layout.sy,
      });
      bumpInkFrame();
    },
    [bumpClipDragFrame, bumpInkFrame, dispatch],
  );

  const commitTextEdit = useCallback(
    (textId: string, content: string) => {
      if (isTextContentEmpty(content)) {
        deleteText(textId);
        return;
      }
      dispatch({ type: 'editText', textId, content });
    },
    [deleteText, dispatch],
  );

  const setTextDraft = useCallback((draft: string | null) => {
    textDraftRef.current = draft;
  }, []);

  const commitPendingTextEditSync = useCallback(() => {
    if (!textEditingRef.current || !textSelectionRef.current) {
      return;
    }
    const { id, content: savedContent } = textSelectionRef.current;
    const content = textDraftRef.current ?? savedContent;
    textDraftRef.current = null;
    setTextEditing(false);
    textLiveRef.current.delete(id);
    setTextLiveTransforms(Object.fromEntries(textLiveRef.current));

    const prev = historyRef.current;
    if (!prev) {
      return;
    }
    const action: EditorDocumentAction = isTextContentEmpty(content)
      ? { type: 'deleteText', textId: id }
      : { type: 'editText', textId: id, content };
    const nextPresent = reduceEditorDocument(prev.present, action, randomId);
    if (nextPresent === prev.present) {
      return;
    }
    const nextHistory = pushEditorHistory(prev, nextPresent, new Map(), false, historyDepthRef.current);
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  }, []);

  const checkpointBeforeHeavyWork = useCallback(async (): Promise<void> => {
    inkIdleScheduler.cancel();
    commitPendingTextEditSync();
    const autosave = autosaveRef.current;
    const api = inkApiRef.current;
    if (!autosave) {
      throw new Error('Autosave not ready');
    }
    await runEditorCheckpoint({
      getHistory: () => historyRef.current,
      setHistory: (next) => {
        historyRef.current = next;
        setHistory(next);
      },
      pendingInkHistory: pendingInkHistoryRef.current,
      clearPendingInkHistory: () => {
        pendingInkHistoryRef.current = [];
      },
      ink: api?.engine ?? null,
      mergeEncodedPng: (encoded) => {
        for (const [rasterId, png] of encoded) {
          if (png.byteLength > 0) {
            encodedPngRef.current.set(rasterId, png);
          }
        }
      },
      scheduleSave: (present, dirtyRasterIds) => {
        autosave.scheduleSave(present, dirtyRasterIds, false);
      },
      flushRouteLeave: () => autosave.flushRouteLeave(),
      collectRasterIds,
    });
  }, [commitPendingTextEditSync, inkIdleScheduler]);

  checkpointBeforeHeavyWorkRef.current = checkpointBeforeHeavyWork;

  idleInkFlushRef.current = async () => {
    const autosave = autosaveRef.current;
    const api = inkApiRef.current;
    if (!autosave) {
      return;
    }
    try {
      await runIdleInkAutosave({
        getHistory: () => historyRef.current,
        setHistory: (next) => {
          historyRef.current = next;
          setHistory(next);
        },
        pendingInkHistory: pendingInkHistoryRef.current,
        clearPendingInkHistory: () => {
          pendingInkHistoryRef.current = [];
        },
        ink: api?.engine ?? null,
        mergeEncodedPng: (encoded) => {
          for (const [rasterId, png] of encoded) {
            if (png.byteLength > 0) {
              encodedPngRef.current.set(rasterId, png);
            }
          }
        },
        scheduleSave: (present, dirtyRasterIds) => {
          autosave.scheduleSave(present, dirtyRasterIds, false);
        },
        flushRouteLeave: () => autosave.flushRouteLeave(),
        collectRasterIds,
      });
    } catch {
      // Idle autosave is best-effort; checkpoint / pagehide still flush.
    }
  };

  const onPdfViewChange = useCallback(
    (patch: { currentPage?: number; zoom?: number; panX?: number; panY?: number }) => {
      dispatch({ type: 'setPdfView', ...patch });
    },
    [dispatch],
  );

  const onPickPdf = useCallback(
    async (file: File) => {
      await importProjectPdf(file, {
        projectId,
        getPresent: () => historyRef.current?.present,
        checkpointBeforeHeavyWork,
        setPdfBytes,
        setPdfMissing,
        dispatch: (action) => dispatch(action),
      });
    },
    [checkpointBeforeHeavyWork, dispatch, projectId],
  );

  const onExtractPdfText = useCallback(
    (payload: PdfExtractPayload) => {
      const present = historyRef.current?.present;
      if (!present || payload.preview.length === 0) {
        return;
      }
      const pane = document.getElementById('editor-workspace-pane');
      if (!pane) {
        return;
      }
      const zoom = Math.max(0.01, present.workspaceZoom);
      const topLeft = screenToWorld(0, 0, present.workspacePanX, present.workspacePanY, zoom);
      const bottomRight = screenToWorld(
        pane.clientWidth,
        pane.clientHeight,
        present.workspacePanX,
        present.workspacePanY,
        zoom,
      );
      const viewport = {
        left: topLeft.x,
        top: topLeft.y,
        right: bottomRight.x,
        bottom: bottomRight.y,
        zoom,
      };
      const cssFont = workspaceFontSizeFromTool(present.tools.textFontSize, present.rasterWidth);
      const content = wrapExtractedText(payload.preview);
      const size = extractedTextBoxSize(content, cssFont);
      const packed = extractPackRef.current
        ? nextExtractPack(extractPackRef.current, size)
        : startExtractPack(viewport, size);
      extractPackRef.current = packed.cursor;
      dispatch({
        type: 'dropPdfTextRange',
        pdfPage: payload.pdfPage,
        range: payload.range,
        attachment: { kind: 'pasteboard' },
        box: packed.box,
        content,
        fontSize: present.tools.textFontSize,
      });
    },
    [dispatch],
  );

  const undo = useCallback(() => {
    clipLiveRef.current.clear();
    setClipLiveTransforms({});
    textLiveRef.current.clear();
    setTextLiveTransforms({});
    const prev = historyRef.current;
    if (!prev) {
      return;
    }
    const pending = pendingInkHistoryRef.current;
    pendingInkHistoryRef.current = [];
    takePendingInkUndo(inkUndoRef.current);
    const withInk = consumePendingInkHistory(prev, pending);
    const next = undoEditorHistory(withInk, inkRestoreSink);
    if (!next) {
      return;
    }
    historyRef.current = next;
    setHistory(next);
    autosaveRef.current?.scheduleSave(next.present, [...(next.future[0]?.inkUndo.keys() ?? [])], false);
    bumpInkFrame();
  }, [inkRestoreSink]);

  const redo = useCallback(() => {
    clipLiveRef.current.clear();
    setClipLiveTransforms({});
    textLiveRef.current.clear();
    setTextLiveTransforms({});
    const prev = historyRef.current;
    if (!prev) {
      return;
    }
    const pending = pendingInkHistoryRef.current;
    pendingInkHistoryRef.current = [];
    takePendingInkUndo(inkUndoRef.current);
    const withInk = consumePendingInkHistory(prev, pending);
    const next = redoEditorHistory(withInk, inkRestoreSink);
    if (!next) {
      return;
    }
    historyRef.current = next;
    setHistory(next);
    autosaveRef.current?.scheduleSave(
      next.present,
      [...(next.past[next.past.length - 1]?.inkUndo.keys() ?? [])],
      false,
    );
    bumpInkFrame();
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
          if ('pasteboard' in effect) {
            createTextAtPointer({ pasteboard: true, x: effect.x, y: effect.y });
          } else {
            createTextAtPointer({ pageId: effect.pageId, x: effect.x, y: effect.y });
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

      if (clipLiveEffects.length > 0) {
        applyClipLiveEffects(clipLiveEffects, present);
      }

      if (clipEffects.length > 0) {
        applyClipEffects(clipEffects, present);
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
    ink: history ? ink : null,
    inkFrame: inkFrame + ink.rasterLayoutGen,
    marqueePreview,
    lassoPreview,
    clipLiveTransforms,
    textLiveTransforms,
    autosaveStatus,
    getPageThumb,
    getClipRasterSize,
    dispatch,
    applyWorkspaceEffects,
    commitTextEdit,
    deleteText,
    duplicateText,
    deleteClip,
    duplicateClip,
    insertClipOnPage,
    mergeSelectedClips,
    setTextEditing,
    undo,
    redo,
    onPdfViewChange,
    onPickPdf,
    onExtractPdfText,
    clearPageInk,
    checkpointBeforeHeavyWork,
    setTextDraft,
  };
}

export { colors };
