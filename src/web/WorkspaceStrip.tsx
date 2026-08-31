'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { PageChromeButtons } from '@/src/web/PageDeleteButton';
import { PageInkCanvas } from '@/src/web/ink/PageInkCanvas';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { effectiveClipPose, type ClipLiveTransform } from '@/src/web/clip/clipLiveTransform';
import {
  PageTextsOnFrame,
  PasteboardTextsLayer,
  TextChromeOverlay,
  textsForFrame,
  type LiveTextContent,
} from '@/src/web/PageTextOverlay';
import type { TextLiveTransform } from '@/src/web/text/textLiveTransform';
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
  const showTextSelection = tool === 'text' || (tool === 'select' && resolvedSelectTargets.text);
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
                  {inkEngine && rasterId ? (
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
                />
                {deletePageId === pageId ? (
                  <PageChromeButtons
                    onInsert={onInsertPage ? () => onInsertPage(pageId) : undefined}
                    onMoveToStock={onMovePageToStock ? () => onMovePageToStock(pageId) : undefined}
                    onDelete={onDeletePage ? () => onDeletePage(pageId) : undefined}
                    onClearInk={onClearPageInk ? () => onClearPageInk(pageId) : undefined}
                  />
                ) : null}
              </div>
              <div
                className={`${styles.pageNumberBand} ${selectedPageId === pageId ? styles.pageNumberBandSelected : ''}`}
                style={{ width: frame.width, marginTop: 0 }}
                {...{ [PAGE_NUMBER_BAND_ATTR]: pageId }}
              >
                {number}
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
      </div>
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
        />
      ) : null}
    </div>
  );
}

export { NUMBER_BAND };
