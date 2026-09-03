'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { spreadPageIdsContaining } from '@/src/domain/layout';
import {
  buildStripFrames,
  NUMBER_BAND,
  pageLocalFromWorld,
  pageInkFrameAtWorld,
  stripLayoutFromDoc,
  type StripLayoutOptions,
} from '@/src/domain/stripGeometry';
import { PAGE_INK_FRAME_ATTR, PAGE_INK_PLANE_ATTR, PAGE_NUMBER_BAND_ATTR, APPEND_SLOT_ATTR, pageInkLocalFromClient, pageInkLocalFromFrameRect, pageFrameMapRect } from '@/src/web/gestures/pageInkDom';
import {
  TEMPLATE_PAGE_NUMBER_COVER,
  isSelectionTool,
  selectTargetFlagsOf,
  type ClipId,
  type ClipMeta,
  type PageId,
  type PasteboardText,
  type SelectTargetFlags,
  type TextId,
  type ToolId,
} from '@/src/domain/types';
import type { PageMeta } from '@/src/storage/types';
import { createWorkspacePointerPipeline, type WorkspaceEffect } from '@/src/web/gestures';
import {
  inkLocalOnPage,
  resolveWorkspaceDropTarget,
  resolveWorkspaceHit,
} from '@/src/web/gestures/resolveHit';
import { PageDragThumbnail } from '@/src/web/PageDragThumbnail';
import { PageChromeOverlay } from '@/src/web/PageDeleteButton';
import { PageInkCanvas } from '@/src/web/ink/PageInkCanvas';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { PasteboardClipsLayer } from '@/src/web/clip/PasteboardClipsLayer';
import { clipWorldAxisAlignedBounds, clipWorldBounds } from '@/src/web/clip/clipGeometry';
import { effectiveClipPose, type ClipLiveTransform } from '@/src/web/clip/clipLiveTransform';
import {
  PageTextsOnFrame,
  PasteboardTextsLayer,
  TextChromeOverlay,
  pageTextCrispZoom,
  textsForFrame,
  type LiveTextContent,
} from '@/src/web/PageTextOverlay';
import type { TextLiveTransform } from '@/src/web/text/textLiveTransform';
import {
  cullWorkspaceInkRasters,
  pageInkWorldAabb,
} from '@/src/web/workspaceViewportCulling';
import { styles } from './editorStyles';

const TEMPLATE_URL = '/page_template.jpg';

type WorkspaceStripProps = {
  workspaceOrder: PageId[];
  pages: Record<PageId, PageMeta>;
  pasteboardClips: ClipMeta[];
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
  pasteboardTexts: PasteboardText[];
  selectedPageId: PageId | null;
  selectedClipId: ClipId | null;
  selectedClipIds?: ClipId[];
  selectedTextId: TextId | null;
  selectedTextIds?: TextId[];
  selectTargets?: SelectTargetFlags;
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
  liveTextContent?: LiveTextContent | null;
  onDeleteText: (textId: TextId) => void;
  onDuplicateText: (textId: TextId) => void;
  onConfirmText?: () => void;
  tool: ToolId;
  zoom: number;
  panX: number;
  panY: number;
  rasterWidth: number;
  rasterHeight: number;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
  stripLayout?: StripLayoutOptions;
  applyWorkspaceEffects: (
    effects: WorkspaceEffect[],
    fingerPositions: Map<number, { x: number; y: number }>,
    surfaceRect: DOMRect | null,
  ) => string | null | undefined;
  /** Optional §9.7 ink thumb from InkEngine (wired by Editor later). */
  getPageThumb?: (pageId: PageId) => ImageBitmap | undefined;
  inkEngine?: InkEngine | null;
  inkFrame?: number;
  deletePageId?: PageId | null;
  onDeletePage?: (pageId: PageId) => void;
  onInsertPage?: (pageId: PageId) => void;
  onMovePageToStock?: (pageId: PageId) => void;
  onClearPageInk?: (pageId: PageId) => void;
};

export function WorkspaceStrip({
  workspaceOrder,
  pages,
  pasteboardClips,
  clipLiveTransforms,
  pasteboardTexts,
  selectedPageId,
  selectedClipId,
  selectedClipIds = [],
  selectedTextId,
  selectedTextIds,
  selectTargets,
  textLiveTransforms,
  liveTextContent,
  onDeleteText,
  onDuplicateText,
  onConfirmText,
  tool,
  zoom,
  panX,
  panY,
  rasterWidth,
  rasterHeight,
  getClipRasterSize,
  stripLayout,
  applyWorkspaceEffects,
  getPageThumb,
  inkEngine = null,
  inkFrame = 0,
  deletePageId = null,
  onDeletePage,
  onInsertPage,
  onMovePageToStock,
  onClearPageInk,
}: WorkspaceStripProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pipelineRef = useRef<ReturnType<typeof createWorkspacePointerPipeline> | null>(null);
  const inkMapCacheRef = useRef<{
    pageId: PageId;
    panX: number;
    panY: number;
    zoom: number;
    rect: DOMRectReadOnly;
  } | null>(null);
  const [grabbedPageId, setGrabbedPageId] = useState<PageId | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const layout = stripLayoutFromDoc(stripLayout ?? {});
  const resolvedSelectTargets = selectTargets ?? selectTargetFlagsOf(undefined);
  const showTextSelection = tool === 'text' || (isSelectionTool(tool) && resolvedSelectTargets.text);
  const visibleSelectedTextIds = showTextSelection
    ? selectedTextIds && selectedTextIds.length > 0
      ? selectedTextIds
      : selectedTextId
        ? [selectedTextId]
        : []
    : [];
  const visibleSelectedTextId = visibleSelectedTextIds[visibleSelectedTextIds.length - 1] ?? null;
  const { frames, dividers, contentWidth, contentHeight } = useMemo(
    () => buildStripFrames(workspaceOrder, layout),
    [workspaceOrder, layout.pagesPerColumn, layout.pairGap, layout.showPairDivider, layout.columnGap],
  );

  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) {
      return;
    }
    const apply = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSurfaceSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    apply();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const resolvedSelectedClipIds =
    selectedClipIds.length > 0 ? selectedClipIds : selectedClipId ? [selectedClipId] : [];

  const alwaysDisplayRasterIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (rasterId: string | undefined) => {
      if (!rasterId || seen.has(rasterId)) {
        return;
      }
      seen.add(rasterId);
      ids.push(rasterId);
    };
    if (grabbedPageId) {
      add(pages[grabbedPageId]?.rasterId);
    }
    for (const clipId of resolvedSelectedClipIds) {
      add(pasteboardClips.find((clip) => clip.id === clipId)?.rasterId);
    }
    if (inkEngine) {
      for (const pageId of workspaceOrder) {
        const rasterId = pages[pageId]?.rasterId;
        if (rasterId && inkEngine.hasPenOverlay(rasterId)) {
          add(rasterId);
        }
      }
      for (const clip of pasteboardClips) {
        if (inkEngine.hasPenOverlay(clip.rasterId)) {
          add(clip.rasterId);
        }
      }
    }
    return ids;
  }, [
    grabbedPageId,
    pages,
    resolvedSelectedClipIds,
    pasteboardClips,
    inkEngine,
    workspaceOrder,
    inkFrame,
  ]);

  const selectedSpreadPageIds = useMemo(
    () => new Set(spreadPageIdsContaining(workspaceOrder, selectedPageId)),
    [workspaceOrder, selectedPageId],
  );

  const inkCull = useMemo(() => {
    const pageItems = frames.flatMap((frame) => {
      if (frame.slot.kind !== 'page') {
        return [];
      }
      const rasterId = pages[frame.slot.pageId]?.rasterId;
      if (!rasterId) {
        return [];
      }
      return [{ rasterId, aabb: pageInkWorldAabb(frame) }];
    });
    const clipItems = pasteboardClips.map((clip) => {
      const pose = effectiveClipPose(clip, clipLiveTransforms[clip.id]);
      const size = getClipRasterSize(clip.id);
      return {
        rasterId: clip.rasterId,
        aabb: clipWorldAxisAlignedBounds(
          clipWorldBounds({ ...clip, ...pose }, size, rasterWidth, rasterHeight),
        ),
      };
    });
    return cullWorkspaceInkRasters({
      surfaceWidth: surfaceSize.width,
      surfaceHeight: surfaceSize.height,
      panX,
      panY,
      zoom,
      pairGap: layout.pairGap,
      columnGap: layout.columnGap,
      pages: pageItems,
      clips: clipItems,
      alwaysDisplayRasterIds,
    });
  }, [
    frames,
    pages,
    pasteboardClips,
    clipLiveTransforms,
    getClipRasterSize,
    rasterWidth,
    rasterHeight,
    surfaceSize.width,
    surfaceSize.height,
    panX,
    panY,
    zoom,
    layout.pairGap,
    layout.columnGap,
    alwaysDisplayRasterIds,
  ]);

  const displayInkKey = inkCull.displayRasterIds.join('\0');
  const displayInkRasterIds = useMemo(
    () => new Set(inkCull.displayRasterIds),
    [displayInkKey, inkCull.displayRasterIds],
  );
  const pinRasterKey = inkCull.pinRasterIds.join('\0');

  useLayoutEffect(() => {
    if (!inkEngine) {
      return;
    }
    inkEngine.setPinnedHotRasterIds(inkCull.pinRasterIds);
    for (const rasterId of inkCull.pinRasterIds) {
      inkEngine.decode(rasterId);
    }
  }, [inkEngine, pinRasterKey, inkCull.pinRasterIds]);

  const syncDragPointer = useCallback(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) {
      return;
    }
    const grabbing = [...pipeline.store.sessions.values()].some((s) => s.mode === 'grabPage');
    if (!grabbing) {
      return;
    }
    const positions = [...pipeline.store.fingerPositions.values()];
    const pos = positions[positions.length - 1];
    if (pos) {
      setDragPointer({ x: pos.x, y: pos.y });
    }
  }, []);

  const ctxRef = useRef({
    workspaceOrder,
    pages,
    pasteboardClips,
    clipLiveTransforms,
    pasteboardTexts,
    selectedPageId,
    selectedClipId,
    selectedClipIds,
    selectedTextId,
    selectedTextIds,
    selectTargets: resolvedSelectTargets,
    tool,
    panX,
    panY,
    zoom,
    rasterWidth,
    rasterHeight,
    getClipRasterSize,
    frames,
  });
  ctxRef.current = {
    workspaceOrder,
    pages,
    pasteboardClips,
    clipLiveTransforms,
    pasteboardTexts,
    selectedPageId,
    selectedClipId,
    selectedClipIds,
    selectedTextId,
    selectedTextIds,
    selectTargets: resolvedSelectTargets,
    tool,
    panX,
    panY,
    zoom,
    rasterWidth,
    rasterHeight,
    getClipRasterSize,
    frames,
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    const pipeline = createWorkspacePointerPipeline({
      get tool() {
        return ctxRef.current.tool;
      },
      get selectedPageId() {
        return ctxRef.current.selectedPageId;
      },
      get selectedClipId() {
        return ctxRef.current.selectedClipId;
      },
      get selectedClipIds() {
        return ctxRef.current.selectedClipIds;
      },
      get selectedTextId() {
        return ctxRef.current.selectedTextId;
      },
      get selectedTextIds() {
        return ctxRef.current.selectedTextIds;
      },
      get selectTargets() {
        return ctxRef.current.selectTargets;
      },
      get panX() {
        return ctxRef.current.panX;
      },
      get panY() {
        return ctxRef.current.panY;
      },
      get zoom() {
        return ctxRef.current.zoom;
      },
      get rasterWidth() {
        return ctxRef.current.rasterWidth;
      },
      get rasterHeight() {
        return ctxRef.current.rasterHeight;
      },
      getClipMeta: (clipId) => ctxRef.current.pasteboardClips.find((c) => c.id === clipId),
      getClipRasterSize: (clipId) => ctxRef.current.getClipRasterSize(clipId),
      resolveHit: (clientX, clientY, surfaceRect) => {
        const el = surfaceRef.current;
        if (!el) {
          return { kind: 'empty' as const };
        }
        const clips = ctxRef.current.pasteboardClips.map((clip) => {
          const live = ctxRef.current.clipLiveTransforms[clip.id];
          if (!live) {
            return clip;
          }
          const pose = effectiveClipPose(clip, live);
          return { ...clip, ...pose };
        });
        return resolveWorkspaceHit({
          clientX,
          clientY,
          surfaceEl: el,
          surfaceRect,
          ...ctxRef.current,
          pasteboardClips: clips,
          tool: ctxRef.current.tool,
          selectTargets: ctxRef.current.selectTargets,
        });
      },
      resolveDropHit: (clientX, clientY, surfaceRect) => {
        const el = surfaceRef.current;
        if (!el) {
          return { kind: 'empty' as const };
        }
        return resolveWorkspaceDropTarget({
          clientX,
          clientY,
          surfaceEl: el,
          surfaceRect,
          ...ctxRef.current,
          tool: ctxRef.current.tool,
        });
      },
      mapInkToPage: (pageId, clientX, clientY) => {
        const el = surfaceRef.current;
        if (!el) {
          return null;
        }
        const { panX, panY, zoom, rasterWidth, rasterHeight } = ctxRef.current;
        let cache = inkMapCacheRef.current;
        if (
          !cache ||
          cache.pageId !== pageId ||
          cache.panX !== panX ||
          cache.panY !== panY ||
          cache.zoom !== zoom
        ) {
          const frameEl = el.querySelector<HTMLElement>(`[${PAGE_INK_FRAME_ATTR}="${pageId}"]`);
          if (!frameEl) {
            return inkLocalOnPage(
              {
                clientX,
                clientY,
                surfaceEl: el,
                ...ctxRef.current,
              },
              pageId,
            );
          }
          cache = { pageId, panX, panY, zoom, rect: pageFrameMapRect(frameEl) };
          inkMapCacheRef.current = cache;
        }
        return pageInkLocalFromFrameRect(cache.rect, clientX, clientY, rasterWidth, rasterHeight);
      },
      mapPageDomLocal: (pageId, clientX, clientY) => {
        const el = surfaceRef.current;
        if (!el) {
          return null;
        }
        return pageInkLocalFromClient(
          el,
          clientX,
          clientY,
          pageId,
          ctxRef.current.rasterWidth,
          ctxRef.current.rasterHeight,
        );
      },
      mapWorldToPage: (pageId, worldX, worldY) => {
        const frame = ctxRef.current.frames.find(
          (candidate) => candidate.slot.kind === 'page' && candidate.slot.pageId === pageId,
        );
        if (!frame) {
          return null;
        }
        return pageLocalFromWorld(
          frame,
          worldX,
          worldY,
          ctxRef.current.rasterWidth,
          ctxRef.current.rasterHeight,
        );
      },
      pageInkAtWorld: (worldX, worldY) => {
        const frame = pageInkFrameAtWorld(ctxRef.current.frames, worldX, worldY);
        if (!frame || frame.slot.kind !== 'page') {
          return null;
        }
        const local = pageLocalFromWorld(
          frame,
          worldX,
          worldY,
          ctxRef.current.rasterWidth,
          ctxRef.current.rasterHeight,
        );
        return { pageId: frame.slot.pageId, localX: local.x, localY: local.y };
      },
      onEffects: (effects) => {
        const grabbed = applyWorkspaceEffects(
          effects,
          pipeline.store.fingerPositions,
          surface.getBoundingClientRect(),
        );
        if (grabbed !== undefined) {
          setGrabbedPageId(grabbed);
          if (grabbed === null) {
            setDragPointer(null);
          } else {
            syncDragPointer();
          }
        }
        const stillGrabbing = [...pipeline.store.sessions.values()].some((s) => s.mode === 'grabPage');
        if (!stillGrabbing && grabbed === undefined) {
          setGrabbedPageId(null);
          setDragPointer(null);
        }
      },
    });
    pipelineRef.current = pipeline;

    const onPointerMove = () => {
      syncDragPointer();
    };
    surface.addEventListener('pointermove', onPointerMove);

    const unbind = pipeline.bind(surface, 'workspace');
    return () => {
      surface.removeEventListener('pointermove', onPointerMove);
      unbind();
      pipeline.reset();
      pipelineRef.current = null;
    };
  }, [applyWorkspaceEffects, syncDragPointer]);

  return (
    <div ref={surfaceRef} className={styles.workspaceSurface} data-ms-shell="workspace">
      {grabbedPageId && dragPointer ? (
        <PageDragThumbnail
          pageId={grabbedPageId}
          clientX={dragPointer.x}
          clientY={dragPointer.y}
          thumb={getPageThumb?.(grabbedPageId)}
          texts={pages[grabbedPageId]?.texts ?? []}
          rasterWidth={rasterWidth}
          rasterHeight={rasterHeight}
        />
      ) : null}
      <div
        className={styles.workspaceTransform}
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          position: 'relative',
          width: contentWidth,
          height: contentHeight,
          ['--ms-screen-px' as string]: String(1 / Math.max(0.1, zoom)),
        }}
      >
        {dividers.map((divider) => (
          <div
            key={divider.key}
            className={styles.pairDivider}
            style={{
              left: divider.x,
              top: divider.y,
              height: divider.height,
            }}
            aria-hidden
          />
        ))}
        {frames.map((frame) => {
          if (frame.slot.kind === 'append') {
            return (
              <div
                key={frame.key}
                className={styles.appendButton}
                style={{
                position: 'absolute',
                left: frame.x,
                top: frame.y,
                width: frame.width,
              }}
                {...{ [APPEND_SLOT_ATTR]: '' }}
                aria-label="ページ追加"
              >
                +
              </div>
            );
          }

          if (frame.slot.kind === 'blank') {
            return (
              <div
                key={frame.key}
                className={styles.stripFrame}
                style={{
                position: 'absolute',
                left: frame.x,
                top: frame.y,
                width: frame.width,
              }}
              >
                <div className={styles.blankSlot} aria-label="余白" />
              </div>
            );
          }

          if (frame.slot.kind !== 'page') {
            return null;
          }

          const { pageId, number } = frame.slot;
          const isGrabbed = grabbedPageId === pageId;
          const rasterId = pages[pageId]?.rasterId;
          const pageTexts = textsForFrame(pageId, pages, textLiveTransforms);
          for (const text of pasteboardTexts) {
            const live = textLiveTransforms[text.id];
            if (live?.where !== 'page' || live.pageId !== pageId) continue;
            pageTexts.push({
              ...text,
              box: {
                x: live.x,
                y: live.y,
                width: live.width ?? text.box.width,
                height: live.height ?? text.box.height,
              },
              fontSize: text.fontSize,
            });
          }

          return (
            <div
              key={frame.key}
              className={styles.stripFrame}
              style={{
                position: 'absolute',
                left: frame.x,
                top: frame.y,
                width: frame.width,
              }}
            >
              <div
                className={`${styles.pageFrame} ${selectedPageId === pageId ? styles.pageFrameSelected : ''} ${isGrabbed ? styles.pageFrameGrabbed : ''}`}
                style={{ backgroundImage: `url(${TEMPLATE_URL})` }}
                {...{ [PAGE_INK_FRAME_ATTR]: pageId }}
              >
                <div className={styles.pageInkPlane} {...{ [PAGE_INK_PLANE_ATTR]: '' }}>
                  {inkEngine && rasterId && displayInkRasterIds.has(rasterId) ? (
                    <PageInkCanvas
                      engine={inkEngine}
                      rasterId={rasterId}
                      displayWidth={frame.width}
                      cssZoom={zoom}
                      inkFrame={inkFrame}
                      className={styles.pageInkCanvas}
                    />
                  ) : null}
                </div>
                <div
                  className={styles.templateCover}
                  style={{
                    left: `${TEMPLATE_PAGE_NUMBER_COVER.x * 100}%`,
                    top: `${TEMPLATE_PAGE_NUMBER_COVER.y * 100}%`,
                    width: `${TEMPLATE_PAGE_NUMBER_COVER.width * 100}%`,
                    height: `${TEMPLATE_PAGE_NUMBER_COVER.height * 100}%`,
                  }}
                />
                <PageTextsOnFrame
                  pageId={pageId}
                  texts={pageTexts}
                  rasterWidth={rasterWidth}
                  rasterHeight={rasterHeight}
                  selectedTextId={visibleSelectedTextId}
                  selectedTextIds={visibleSelectedTextIds}
                  textLiveTransforms={textLiveTransforms}
                  liveTextContent={liveTextContent}
                  crispZoom={pageTextCrispZoom(zoom, selectedSpreadPageIds.has(pageId))}
                />
              </div>
              <div
                className={`${styles.pageNumberBand} ${selectedPageId === pageId ? styles.pageNumberBandSelected : ''}`}
                style={{ width: frame.width, marginTop: 0 }}
              >
                <span className={styles.pageNumberHit} {...{ [PAGE_NUMBER_BAND_ATTR]: pageId }}>
                  {number}
                </span>
              </div>
            </div>
          );
        })}
        <PasteboardTextsLayer
          frames={frames}
          pages={pages}
          texts={pasteboardTexts}
          rasterWidth={rasterWidth}
          rasterHeight={rasterHeight}
          selectedTextId={visibleSelectedTextId}
          selectedTextIds={visibleSelectedTextIds}
          textLiveTransforms={textLiveTransforms}
          liveTextContent={liveTextContent}
        />
        {inkEngine ? (
          <PasteboardClipsLayer
            clips={pasteboardClips}
            selectedClipIds={resolvedSelectedClipIds}
            clipLiveTransforms={clipLiveTransforms}
            engine={inkEngine}
            rasterWidth={rasterWidth}
            rasterHeight={rasterHeight}
            zoom={zoom}
            inkFrame={inkFrame}
            getClipRasterSize={getClipRasterSize}
            displayInkRasterIds={displayInkRasterIds}
          />
        ) : null}
      </div>
      {deletePageId ? (
        <PageChromeOverlay
          surfaceRef={surfaceRef}
          pageId={deletePageId}
          zoom={zoom}
          panX={panX}
          panY={panY}
          onInsert={onInsertPage ? () => onInsertPage(deletePageId) : undefined}
          onMoveToStock={onMovePageToStock ? () => onMovePageToStock(deletePageId) : undefined}
          onDelete={onDeletePage ? () => onDeletePage(deletePageId) : undefined}
          onClearInk={onClearPageInk ? () => onClearPageInk(deletePageId) : undefined}
        />
      ) : null}
      {visibleSelectedTextId ? (
        <TextChromeOverlay
          surfaceRef={surfaceRef}
          textIds={visibleSelectedTextIds}
          zoom={zoom}
          panX={panX}
          panY={panY}
          layoutKey={textLiveTransforms}
          showConfirm={tool === 'text'}
          onDeleteText={onDeleteText}
          onDuplicateText={onDuplicateText}
          onConfirmText={onConfirmText}
        />
      ) : null}
    </div>
  );
}

export { NUMBER_BAND };
