'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import { PAGE_DISPLAY_H, PAGE_DISPLAY_W, buildStripFrames, stripLayoutFromDoc } from '@/src/domain/stripGeometry';
import {
  isStockClipItem,
  isStockTextItem,
  parseStockThumbKey,
  stockIndexByKey,
  stockPagesThenForeground,
  stockThumbKey,
} from '@/src/domain/stockItems';
import { findText } from '@/src/domain/text';
import type { PageId, PageText } from '@/src/domain/types';
import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { THUMB_HEIGHT, THUMB_WIDTH } from '@/src/web/ink/InkEngine';
import { drawPageTextsOnThumb } from '@/src/web/ink/drawPageTextsOnThumb';
import { PageDragThumbnail } from '@/src/web/PageDragThumbnail';
import { PageChromeButtons } from '@/src/web/PageDeleteButton';
import { PAGE_TEMPLATE_URL } from '@/src/web/PageThumbLayers';
import {
  dropStockPageToTrash,
  dropWorkspacePageToTrash,
  moveClipToStock,
  moveTextToStock,
  moveWorkspacePageToStock,
  placeStockPage,
  returnStockPageToWorkspace,
  returnStockTextToWorkspace,
  returnTrashPageToWorkspace,
} from '@/src/web/stock/stockActions';
import {
  clientToStockWorld,
  clientToWorkspaceWorld,
  pointInRect,
  resolveWorkspaceInsertIndex,
  STOCK_FREE_PAGE_HEIGHT,
  STOCK_FREE_PAGE_WIDTH,
  STOCK_FREE_THUMB_HEIGHT,
  STOCK_FREE_THUMB_WIDTH,
} from '@/src/web/stock/stockCoords';
import { reduceStockEffects } from '@/src/web/stock/stockEffects';
import { createStockPointerPipeline, getStockDragPageId } from '@/src/web/stock/stockPointer';
import { fitStockTextThumbFontSize, STOCK_TEXT_THUMB_BASE_PX } from '@/src/web/stock/stockTextThumbFit';
import type { StockHit } from '@/src/web/stock/types';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';
import { styles } from './editorStyles';

// #region agent log
const DEBUG_STOCK_FREE_INGEST =
  'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426';

function debugStockFreeViewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  return {
    innerW: typeof window !== 'undefined' ? window.innerWidth : 0,
    innerH: typeof window !== 'undefined' ? window.innerHeight : 0,
    vvOffsetLeft: vv?.offsetLeft ?? 0,
    vvOffsetTop: vv?.offsetTop ?? 0,
    vvPageLeft: vv?.pageLeft ?? 0,
    vvPageTop: vv?.pageTop ?? 0,
    vvScale: vv?.scale ?? 1,
    vvW: vv?.width ?? 0,
    vvH: vv?.height ?? 0,
  };
}

function debugStockFreeGeom(
  clientX: number,
  clientY: number,
  surface: HTMLElement | null,
  panX: number,
  panY: number,
  zoom: number,
  itemKey: string | null,
) {
  const surfaceRect = surface?.getBoundingClientRect() ?? null;
  const transformEl = surface?.querySelector(`.${styles.stockTransform}`) as HTMLElement | null;
  const transformRect = transformEl?.getBoundingClientRect() ?? null;
  const itemEl = itemKey
    ? (document.querySelector(`[data-stock-item-key="${itemKey}"]`) as HTMLElement | null)
    : null;
  const itemRect = itemEl?.getBoundingClientRect() ?? null;
  const localX = surfaceRect ? clientX - surfaceRect.left : null;
  const localY = surfaceRect ? clientY - surfaceRect.top : null;
  const rawWorld =
    localX != null && localY != null && zoom !== 0
      ? { x: (localX - panX) / zoom, y: (localY - panY) / zoom }
      : null;
  return {
    surface: surfaceRect
      ? { left: surfaceRect.left, top: surfaceRect.top, w: surfaceRect.width, h: surfaceRect.height }
      : null,
    transform: transformRect
      ? {
          left: transformRect.left,
          top: transformRect.top,
          w: transformRect.width,
          h: transformRect.height,
        }
      : null,
    itemRect: itemRect
      ? {
          left: itemRect.left,
          top: itemRect.top,
          w: itemRect.width,
          h: itemRect.height,
          cx: itemRect.left + itemRect.width / 2,
          cy: itemRect.top + itemRect.height / 2,
        }
      : null,
    localX,
    localY,
    rawWorld,
    pointerToItemTL: itemRect
      ? { x: clientX - itemRect.left, y: clientY - itemRect.top }
      : null,
    pointerToItemCenter: itemRect
      ? {
          x: clientX - (itemRect.left + itemRect.width / 2),
          y: clientY - (itemRect.top + itemRect.height / 2),
        }
      : null,
  };
}
// #endregion

const GRID_THUMB_BASE_PX = 56;
const GRID_THUMB_MIN_PX = 36;
const EMPTY_TEXTS: readonly PageText[] = [];

function stockDropTargetKey(clientX: number, clientY: number, excludeKey: string): string | null {
  if (typeof document.elementsFromPoint !== 'function') {
    return null;
  }
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const thumb = (node as Element).closest?.('[data-stock-item-key], [data-stock-page-id]');
    if (!thumb) {
      continue;
    }
    const key =
      thumb.getAttribute('data-stock-item-key') ?? thumb.getAttribute('data-stock-page-id');
    if (key && key !== excludeKey) {
      return key;
    }
  }
  return null;
}

export const STOCK_TRASH_DROP_ATTR = 'data-stock-trash-drop';

function setTrashDropHover(on: boolean): void {
  document.querySelector(`[${STOCK_TRASH_DROP_ATTR}]`)?.toggleAttribute('data-drop-hover', on);
}

export type WorkspaceGrab = {
  pageId?: PageId;
  fromIndex?: number;
  clipId?: string;
  textId?: string;
  clipIds?: string[];
  textIds?: string[];
};

function grabClipIds(grab: WorkspaceGrab): string[] {
  if (grab.clipIds && grab.clipIds.length > 0) {
    return grab.clipIds;
  }
  return grab.clipId ? [grab.clipId] : [];
}

function grabTextIds(grab: WorkspaceGrab): string[] {
  if (grab.textIds && grab.textIds.length > 0) {
    return grab.textIds;
  }
  return grab.textId ? [grab.textId] : [];
}

function pointOverStockUi(clientX: number, clientY: number, surface: HTMLElement | null): boolean {
  const region = document.querySelector('[data-ms-region="stock"]');
  if (region && pointInRect(clientX, clientY, region.getBoundingClientRect())) {
    return true;
  }
  if (surface && pointInRect(clientX, clientY, surface.getBoundingClientRect())) {
    return true;
  }
  const trashDrop = document.querySelector<HTMLElement>(`[${STOCK_TRASH_DROP_ATTR}]`);
  return Boolean(trashDrop && pointInRect(clientX, clientY, trashDrop.getBoundingClientRect()));
}

function stockDragGhostKeys(
  workspaceGrab: WorkspaceGrab | null,
  draggedStockPageId: string | null,
  workspaceClipTextOverStock: boolean,
): string[] {
  if (draggedStockPageId) {
    return [draggedStockPageId];
  }
  if (!workspaceGrab) {
    return [];
  }
  if (workspaceGrab.pageId) {
    return [workspaceGrab.pageId];
  }
  if (!workspaceClipTextOverStock) {
    return [];
  }
  return [
    ...grabClipIds(workspaceGrab).map((id) => `clip:${id}`),
    ...grabTextIds(workspaceGrab).map((id) => `text:${id}`),
  ];
}

export type StockPaneProps = {
  doc: EditorDocument;
  dispatch: (action: EditorDocumentAction) => void;
  workspaceGrab: WorkspaceGrab | null;
  onWorkspaceGrabEnd: () => void;
  onDroppedToTrash?: () => void;
  getPageThumb?: (pageId: PageId) => ImageBitmap | undefined;
  inkEngine?: InkEngine | null;
  deletePageId?: PageId | null;
  onShowPageDelete?: (pageId: PageId | null) => void;
  onDeletePage?: (pageId: PageId) => void;
};

type StockPageThumbProps = {
  pageId: PageId;
  rasterId?: string;
  texts: readonly PageText[];
  rasterWidth: number;
  rasterHeight: number;
  inkEngine?: InkEngine | null;
};

function stockTransformCss(panX: number, panY: number, zoom: number): string {
  return `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function isStockViewSessionMode(mode: string): boolean {
  return mode === 'pan' || mode === 'pinch' || mode === 'zoomDrag';
}

function composeStockThumbObjectUrl(
  thumb: ImageBitmap,
  texts: readonly PageText[],
  rasterWidth: number,
  rasterHeight: number,
): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.resolve(null);
  }
  ctx.drawImage(thumb, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  if (texts.length > 0 && rasterWidth > 0 && rasterHeight > 0) {
    drawPageTextsOnThumb(ctx, texts, rasterWidth, rasterHeight, THUMB_WIDTH, THUMB_HEIGHT);
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
}

const StockPageThumb = memo(function StockPageThumb({
  rasterId,
  texts,
  rasterWidth,
  rasterHeight,
  inkEngine,
}: StockPageThumbProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!inkEngine || !rasterId) {
      setSrc(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const applyFromCache = async () => {
      const thumb = inkEngine.getThumb(rasterId);
      if (!thumb) {
        return;
      }
      const url = await composeStockThumbObjectUrl(thumb, texts, rasterWidth, rasterHeight);
      if (cancelled) {
        if (url) {
          URL.revokeObjectURL(url);
        }
        return;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      objectUrl = url;
      setSrc(url);
    };

    if (!inkEngine.getThumb(rasterId)) {
      void inkEngine.generateThumb(rasterId);
    } else {
      void applyFromCache();
    }

    const unsubscribe = inkEngine.subscribeThumbReady((id) => {
      if (id === rasterId) {
        void applyFromCache();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [inkEngine, rasterId, texts, rasterWidth, rasterHeight]);

  if (!inkEngine || !rasterId) {
    return null;
  }

  return (
    <div className={styles.stockThumbInkHost}>
      {src ? (
        <img className={styles.stockPageInkImg} src={src} alt="" draggable={false} />
      ) : null}
    </div>
  );
}, (prev, next) => (
  prev.pageId === next.pageId &&
  prev.rasterId === next.rasterId &&
  prev.texts === next.texts &&
  prev.rasterWidth === next.rasterWidth &&
  prev.rasterHeight === next.rasterHeight &&
  prev.inkEngine === next.inkEngine
));

function StockTextThumb({
  content,
  color,
}: {
  content: string;
  color: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const preview = content.trim() || 'テキスト';
  const [fontSize, setFontSize] = useState(STOCK_TEXT_THUMB_BASE_PX);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const fit = () => {
      const style = getComputedStyle(host);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const width = Math.max(1, host.clientWidth - (Number.isFinite(padX) ? padX : 0));
      const height = Math.max(1, host.clientHeight - (Number.isFinite(padY) ? padY : 0));
      setFontSize(fitStockTextThumbFontSize(preview, width, height));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [preview]);

  return (
    <div ref={hostRef} className={styles.stockTextThumb} style={{ color, fontSize }}>
      {preview}
    </div>
  );
}

function StockItemDragGhost({
  itemKey,
  clientX,
  clientY,
  grabOffset,
  doc,
  inkEngine,
  getPageThumb,
}: {
  itemKey: string;
  clientX: number;
  clientY: number;
  grabOffset?: { x: number; y: number };
  doc: EditorDocument;
  inkEngine?: InkEngine | null;
  getPageThumb?: (pageId: PageId) => ImageBitmap | undefined;
}) {
  const parsed = parseStockThumbKey(itemKey);
  if (!parsed) {
    return null;
  }
  if (parsed.kind === 'page') {
    return (
      <PageDragThumbnail
        pageId={parsed.pageId}
        clientX={clientX}
        clientY={clientY}
        grabOffset={grabOffset}
        thumb={getPageThumb?.(parsed.pageId)}
        texts={doc.pages[parsed.pageId]?.texts ?? EMPTY_TEXTS}
        rasterWidth={doc.rasterWidth}
        rasterHeight={doc.rasterHeight}
      />
    );
  }
  if (typeof document === 'undefined') {
    return null;
  }
  const clip = parsed.kind === 'clip' ? doc.pasteboardClips.find((c) => c.id === parsed.clipId) : undefined;
  const text =
    parsed.kind === 'text' ? findText(doc, parsed.textId)?.node : undefined;
  return createPortal(
    <div
      className={`${styles.stockDragGhost} ${parsed.kind === 'clip' ? styles.stockThumbClip : styles.stockThumbText}`}
      style={{
        left: clientX,
        top: clientY,
        width: STOCK_FREE_THUMB_WIDTH,
        height: STOCK_FREE_THUMB_HEIGHT,
        ...(grabOffset
          ? { transform: `translate(${-grabOffset.x}px, ${-grabOffset.y}px)` }
          : {}),
      }}
      aria-hidden
    >
      <div className={styles.stockClipPad}>
        {parsed.kind === 'clip' ? (
          <StockPageThumb
            pageId={parsed.clipId}
            rasterId={clip?.rasterId}
            texts={EMPTY_TEXTS}
            rasterWidth={doc.rasterWidth}
            rasterHeight={doc.rasterHeight}
            inkEngine={inkEngine}
          />
        ) : (
          <StockTextThumb content={text?.content ?? ''} color={text?.color ?? '#1A1A1A'} />
        )}
      </div>
    </div>,
    document.body,
  );
}

export function StockPane({
  doc,
  dispatch,
  workspaceGrab,
  onWorkspaceGrabEnd,
  onDroppedToTrash,
  getPageThumb,
  inkEngine,
  deletePageId = null,
  onShowPageDelete,
  onDeletePage,
}: StockPaneProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  const pipelineRef = useRef<ReturnType<typeof createStockPointerPipeline> | null>(null);
  const liveViewRef = useRef({ zoom: doc.stockZoom, panX: doc.stockPanX, panY: doc.stockPanY });
  const viewGestureRef = useRef(false);
  const [draggedStockPageId, setDraggedStockPageId] = useState<PageId | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const [overStockUi, setOverStockUi] = useState(false);
  const [stockDeleteKey, setStockDeleteKey] = useState<string | null>(null);
  const [stockGrabScreen, setStockGrabScreen] = useState<{ key: string; x: number; y: number } | null>(null);
  // #region agent log
  const stockFreeGrabRef = useRef<{
    key: string;
    itemX: number;
    itemY: number;
    grabOffsetWorldX: number;
    grabOffsetWorldY: number;
    grabOffsetScreenX: number;
    grabOffsetScreenY: number;
    itemRectW: number;
    itemRectH: number;
  } | null>(null);
  // #endregion

  const docRef = useRef(doc);
  docRef.current = doc;

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const workspaceGrabRef = useRef(workspaceGrab);
  workspaceGrabRef.current = workspaceGrab;

  const onWorkspaceGrabEndRef = useRef(onWorkspaceGrabEnd);
  onWorkspaceGrabEndRef.current = onWorkspaceGrabEnd;
  const onDroppedToTrashRef = useRef(onDroppedToTrash);
  onDroppedToTrashRef.current = onDroppedToTrash;
  const onShowPageDeleteRef = useRef(onShowPageDelete);
  onShowPageDeleteRef.current = onShowPageDelete;
  const trashPane = doc.stockPane === 'trash';
  const paneLayout = trashPane ? 'grid' : doc.stockLayout;
  const paneItems = trashPane
    ? [
        ...doc.trash.map((pageId) => ({ pageId, x: 0, y: 0 })),
        ...(doc.trashClips ?? []).map((clipId) => ({ kind: 'clip' as const, clipId, x: 0, y: 0 })),
        ...(doc.trashTexts ?? []).map((textId) => ({ kind: 'text' as const, textId, x: 0, y: 0 })),
      ]
    : stockPagesThenForeground(doc.stock);

  useLayoutEffect(() => {
    if (viewGestureRef.current) {
      return;
    }
    liveViewRef.current = { zoom: doc.stockZoom, panX: doc.stockPanX, panY: doc.stockPanY };
    const el = transformRef.current;
    if (el) {
      el.style.transform = stockTransformCss(doc.stockPanX, doc.stockPanY, doc.stockZoom);
    }
  }, [doc.stockZoom, doc.stockPanX, doc.stockPanY]);

  const syncDragPointer = useCallback(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) {
      return;
    }
    const dragging = getStockDragPageId(pipeline.store);
    if (!dragging) {
      return;
    }
    const positions = [...pipeline.store.fingerPositions.values()];
    const pos = positions[positions.length - 1];
    if (pos) {
      setDragPointer({ x: pos.x, y: pos.y });
    }
  }, []);

  const resolveHit = useCallback((clientX: number, clientY: number): StockHit => {
    const surface = surfaceRef.current;
    if (!surface) {
      return { kind: 'empty' };
    }
    const target = document.elementFromPoint(clientX, clientY);
    if (!target || !surface.contains(target)) {
      return { kind: 'empty' };
    }
    const thumb = (target as HTMLElement).closest('[data-stock-item-key], [data-stock-page-id]');
    if (thumb) {
      const key =
        thumb.getAttribute('data-stock-item-key') ?? thumb.getAttribute('data-stock-page-id');
      if (key) {
        return { kind: 'thumb', pageId: key };
      }
    }
    return { kind: 'empty' };
  }, []);

  const captureStockFreeGrab = useCallback((clientX: number, clientY: number, itemKey: string) => {
    const present = docRef.current;
    if (present.stockLayout !== 'free' || present.stockPane === 'trash') {
      return;
    }
    const item = present.stock.find((entry) => stockThumbKey(entry) === itemKey);
    if (!item) {
      return;
    }
    const view = liveViewRef.current;
    const geom = debugStockFreeGeom(
      clientX,
      clientY,
      surfaceRef.current,
      view.panX,
      view.panY,
      view.zoom,
      itemKey,
    );
    const zoom = view.zoom || 1;
    const grabOffsetScreenX = geom.itemRect ? clientX - geom.itemRect.left : 0;
    const grabOffsetScreenY = geom.itemRect ? clientY - geom.itemRect.top : 0;
    stockFreeGrabRef.current = {
      key: itemKey,
      itemX: item.x,
      itemY: item.y,
      grabOffsetWorldX: grabOffsetScreenX / zoom,
      grabOffsetWorldY: grabOffsetScreenY / zoom,
      grabOffsetScreenX,
      grabOffsetScreenY,
      itemRectW: geom.itemRect?.w ?? 0,
      itemRectH: geom.itemRect?.h ?? 0,
    };
    setStockGrabScreen({ key: itemKey, x: grabOffsetScreenX, y: grabOffsetScreenY });
    // #region agent log
    ipadDebugLog({
      sessionId: '18f9a4',
      ingest: DEBUG_STOCK_FREE_INGEST,
      runId: 'post-fix',
      hypothesisId: 'A',
      location: 'StockPane.tsx:grabDown',
      message: 'stock free grab down',
      timestamp: Date.now(),
      data: {
        key: itemKey,
        pointer: { x: clientX, y: clientY },
        item: { x: item.x, y: item.y },
        liveView: view,
        grabOffsetWorld: { x: grabOffsetScreenX / zoom, y: grabOffsetScreenY / zoom },
        grabOffsetScreen: { x: grabOffsetScreenX, y: grabOffsetScreenY },
        geom,
      },
    });
    // #endregion
  }, []);

  const applyStockEffects = useCallback(
    (effects: Parameters<typeof reduceStockEffects>[1]) => {
      const present = docRef.current;
      const pipeline = pipelineRef.current;
      if (!pipeline || effects.length === 0) {
        return;
      }
      const gridOrTrash = present.stockLayout === 'grid' || present.stockPane === 'trash';
      const viewSource = gridOrTrash
        ? present
        : {
            ...present,
            stockZoom: liveViewRef.current.zoom,
            stockPanX: liveViewRef.current.panX,
            stockPanY: liveViewRef.current.panY,
          };
      const batch = reduceStockEffects(
        viewSource,
        effects,
        pipeline.store.fingerPositions,
        surfaceRef.current?.getBoundingClientRect() ?? null,
      );
      if (batch.view) {
        if (gridOrTrash) {
          if (batch.view.zoom !== present.stockZoom) {
            dispatchRef.current({
              type: 'setStockView',
              zoom: batch.view.zoom,
              panX: 0,
              panY: 0,
            });
          }
          const surface = surfaceRef.current;
          if (surface) {
            surface.scrollLeft -= batch.view.panX - present.stockPanX;
          }
        } else {
          viewGestureRef.current = true;
          liveViewRef.current = batch.view;
          const el = transformRef.current;
          if (el) {
            el.style.transform = stockTransformCss(batch.view.panX, batch.view.panY, batch.view.zoom);
          }
        }
      }
      for (const action of batch.actions) {
        dispatchRef.current(action);
      }
      for (const effect of effects) {
        if (effect.type === 'commitView') {
          const stillViewing = [...pipeline.store.sessions.values()].some((session) =>
            isStockViewSessionMode(session.mode),
          );
          if (!stillViewing) {
            viewGestureRef.current = false;
            const view = liveViewRef.current;
            if (
              view.zoom !== present.stockZoom ||
              view.panX !== present.stockPanX ||
              view.panY !== present.stockPanY
            ) {
              dispatchRef.current({
                type: 'setStockView',
                zoom: view.zoom,
                panX: view.panX,
                panY: view.panY,
              });
            }
          }
        }
        if (effect.type === 'showPageDelete' && present.stockPane !== 'trash') {
          const parsed = parseStockThumbKey(effect.pageId);
          if (parsed?.kind === 'page') {
            setStockDeleteKey(null);
            onShowPageDeleteRef.current?.(parsed.pageId);
          } else if (parsed) {
            onShowPageDeleteRef.current?.(null);
            setStockDeleteKey(effect.pageId);
          }
        }
        if (effect.type === 'dragPage') {
          setStockDeleteKey(null);
          onShowPageDeleteRef.current?.(null);
          // #region agent log
          if (present.stockLayout === 'free' && present.stockPane !== 'trash') {
            const pos = [...pipeline.store.fingerPositions.values()].at(-1);
            if (pos && stockFreeGrabRef.current?.key !== effect.pageId) {
              captureStockFreeGrab(pos.x, pos.y, effect.pageId);
            }
            const grab = stockFreeGrabRef.current;
            ipadDebugLog({
              sessionId: '18f9a4',
              ingest: DEBUG_STOCK_FREE_INGEST,
              runId: 'post-fix',
              hypothesisId: 'A',
              location: 'StockPane.tsx:dragStart',
              message: 'stock free drag start',
              timestamp: Date.now(),
              data: {
                key: effect.pageId,
                pointer: pos ?? null,
                liveView: liveViewRef.current,
                grab,
                docPan: { x: present.stockPanX, y: present.stockPanY },
                docZoom: present.stockZoom,
              },
            });
          }
          // #endregion
        }
      }
      if (batch.draggedPageId !== undefined) {
        setDraggedStockPageId(batch.draggedPageId);
        syncDragPointer();
      }
      const stillDragging = getStockDragPageId(pipeline.store);
      if (!stillDragging && batch.draggedPageId === undefined) {
        setDraggedStockPageId(null);
        setDragPointer(null);
      }
    },
    [syncDragPointer, captureStockFreeGrab],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    const pipeline = createStockPointerPipeline({
      layout: paneLayout,
      resolveHit,
      onEffects: applyStockEffects,
    });
    pipelineRef.current = pipeline;

    const onPointerMove = () => {
      syncDragPointer();
    };
    const onPointerDownGrab = (event: PointerEvent) => {
      const hit = resolveHit(event.clientX, event.clientY);
      if (hit.kind === 'thumb') {
        captureStockFreeGrab(event.clientX, event.clientY, hit.pageId);
      }
    };
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerdown', onPointerDownGrab);

    const onWheel = (event: WheelEvent) => {
      if (paneLayout !== 'grid') {
        return;
      }
      if (event.deltaX !== 0) {
        return;
      }
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      surface.scrollLeft += event.deltaY;
    };
    surface.addEventListener('wheel', onWheel, { passive: false });

    const unbind = pipeline.bind(surface);
    return () => {
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerdown', onPointerDownGrab);
      surface.removeEventListener('wheel', onWheel);
      unbind();
      pipeline.reset();
      pipelineRef.current = null;
    };
  }, [applyStockEffects, resolveHit, syncDragPointer, captureStockFreeGrab, paneLayout, trashPane]);

  useLayoutEffect(() => {
    if (paneLayout !== 'grid') {
      return;
    }
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    surface.scrollLeft = surface.scrollWidth - surface.clientWidth;
  }, [paneLayout, paneItems.length, trashPane]);

  const finishCrossPaneDrop = useCallback((clientX: number, clientY: number) => {
    const present = docRef.current;
    const stockSurface = surfaceRef.current;
    const workspaceSurface = document.querySelector(`.${styles.workspaceSurface}`) as HTMLElement | null;
    const trashDrop = document.querySelector<HTMLElement>(`[${STOCK_TRASH_DROP_ATTR}]`);

    const stockDragId = pipelineRef.current ? getStockDragPageId(pipelineRef.current.store) : null;
    const stockDrag = stockDragId ? parseStockThumbKey(stockDragId) : null;
    const grab = workspaceGrabRef.current;
    const overTrashButton = trashDrop ? pointInRect(clientX, clientY, trashDrop.getBoundingClientRect()) : false;
    const overTrashPane =
      present.stockPane === 'trash' &&
      stockSurface != null &&
      pointInRect(clientX, clientY, stockSurface.getBoundingClientRect());
    const overTrash = overTrashButton || overTrashPane;

    const stockWorld = (
      thumbSize?: { width: number; height: number },
      grabOffset?: { x: number; y: number },
    ) => {
      if (!stockSurface) {
        return { x: 0, y: 0 };
      }
      const stockRect = stockSurface.getBoundingClientRect();
      const view = liveViewRef.current;
      return clientToStockWorld(
        clientX,
        clientY,
        stockRect,
        view.panX,
        view.panY,
        view.zoom,
        present.stockLayout,
        thumbSize,
        grabOffset,
      );
    };
    const pageThumbSize = { width: STOCK_FREE_PAGE_WIDTH, height: STOCK_FREE_PAGE_HEIGHT };
    const itemThumbSize = { width: STOCK_FREE_THUMB_WIDTH, height: STOCK_FREE_THUMB_HEIGHT };

    if (overTrash && grab?.pageId) {
      for (const action of dropWorkspacePageToTrash(grab.pageId)) {
        dispatchRef.current(action);
      }
      dispatchRef.current({ type: 'setUiLayout', stockPane: 'trash' });
      onDroppedToTrashRef.current?.();
      onWorkspaceGrabEndRef.current();
      setTrashDropHover(false);
      return;
    }

    const grabbedClips = grab ? grabClipIds(grab) : [];
    const grabbedTexts = grab ? grabTextIds(grab) : [];

    if (overTrash && (grabbedClips.length > 0 || grabbedTexts.length > 0)) {
      if (grabbedClips.length > 0) {
        dispatchRef.current({ type: 'deleteClip', clipIds: grabbedClips });
      }
      for (const textId of grabbedTexts) {
        dispatchRef.current({ type: 'deleteText', textId });
      }
      onDroppedToTrashRef.current?.();
      onWorkspaceGrabEndRef.current();
      setTrashDropHover(false);
      return;
    }

    if (overTrash && stockDrag?.kind === 'page' && present.stockPane !== 'trash') {
      for (const action of dropStockPageToTrash(stockDrag.pageId)) {
        dispatchRef.current(action);
      }
      dispatchRef.current({ type: 'setUiLayout', stockPane: 'trash' });
      onDroppedToTrashRef.current?.();
      setDraggedStockPageId(null);
      setDragPointer(null);
      setTrashDropHover(false);
      return;
    }

    if (overTrash && stockDrag?.kind === 'clip' && present.stockPane !== 'trash') {
      dispatchRef.current({ type: 'deleteStockClip', clipId: stockDrag.clipId });
      onDroppedToTrashRef.current?.();
      setDraggedStockPageId(null);
      setDragPointer(null);
      setTrashDropHover(false);
      return;
    }

    if (overTrash && stockDrag?.kind === 'text' && present.stockPane !== 'trash') {
      dispatchRef.current({ type: 'deleteStockText', textId: stockDrag.textId });
      onDroppedToTrashRef.current?.();
      setDraggedStockPageId(null);
      setDragPointer(null);
      setTrashDropHover(false);
      return;
    }

    const overStockPane =
      stockSurface != null &&
      present.stockPane !== 'trash' &&
      pointInRect(clientX, clientY, stockSurface.getBoundingClientRect());

    if (grab && overStockPane) {
      const { x, y } = stockWorld(grab.pageId ? pageThumbSize : itemThumbSize);
      if (grab.pageId && grab.fromIndex !== undefined) {
        for (const action of moveWorkspacePageToStock(
          grab.pageId,
          grab.fromIndex,
          x,
          y,
          present.rasterWidth,
          present.rasterHeight,
        )) {
          dispatchRef.current(action);
        }
      } else {
        const clips = grabClipIds(grab);
        const texts = grabTextIds(grab);
        const gap = 80;
        let slot = 0;
        for (const clipId of clips) {
          for (const action of moveClipToStock(
            clipId,
            x + slot * gap,
            y,
            present.rasterWidth,
            present.rasterHeight,
          )) {
            dispatchRef.current(action);
          }
          slot += 1;
        }
        for (const textId of texts) {
          for (const action of moveTextToStock(
            textId,
            x + slot * gap,
            y,
            present.rasterWidth,
            present.rasterHeight,
          )) {
            dispatchRef.current(action);
          }
          slot += 1;
        }
      }
      onWorkspaceGrabEndRef.current();
      return;
    }

    if (stockDrag && overStockPane && stockDragId) {
      if (present.stockLayout === 'grid') {
        const targetKey = stockDropTargetKey(clientX, clientY, stockDragId);
        if (targetKey) {
          const fromIndex = stockIndexByKey(present.stock, stockDragId);
          const toIndex = stockIndexByKey(present.stock, targetKey);
          if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
            dispatchRef.current({
              type: 'reorderStock',
              fromIndex,
              toIndex,
            });
            setDraggedStockPageId(null);
            setDragPointer(null);
            return;
          }
        }
      }
      if (present.stockLayout === 'free') {
        const thumbSize = stockDrag.kind === 'page' ? pageThumbSize : itemThumbSize;
        const storedGrab = stockFreeGrabRef.current;
        const grabOffset =
          storedGrab && storedGrab.key === stockDragId
            ? { x: storedGrab.grabOffsetWorldX, y: storedGrab.grabOffsetWorldY }
            : undefined;
        const { x, y } = stockWorld(thumbSize, grabOffset);
        // #region agent log
        {
          const view = liveViewRef.current;
          const geom = debugStockFreeGeom(
            clientX,
            clientY,
            stockSurface,
            view.panX,
            view.panY,
            view.zoom,
            stockDragId,
          );
          const grabDrop =
            storedGrab && geom.rawWorld
              ? {
                  x: geom.rawWorld.x - storedGrab.grabOffsetWorldX,
                  y: geom.rawWorld.y - storedGrab.grabOffsetWorldY,
                }
              : null;
          const predictedTL = geom.surface
            ? {
                x: geom.surface.left + view.panX + x * view.zoom,
                y: geom.surface.top + view.panY + y * view.zoom,
              }
            : null;
          const grabPointError =
            predictedTL && storedGrab
              ? {
                  x: predictedTL.x + storedGrab.grabOffsetScreenX - clientX,
                  y: predictedTL.y + storedGrab.grabOffsetScreenY - clientY,
                }
              : null;
          ipadDebugLog({
            sessionId: '18f9a4',
            ingest: DEBUG_STOCK_FREE_INGEST,
            runId: 'post-fix',
            hypothesisId: 'A',
            location: 'StockPane.tsx:freeDrop',
            message: 'stock free drop',
            timestamp: Date.now(),
            data: {
              key: stockDragId,
              kind: stockDrag.kind,
              origin: grabOffset ? 'grab' : 'center',
              pointer: { x: clientX, y: clientY },
              liveView: view,
              thumbSize,
              drop: { x, y },
              grab: storedGrab,
              grabDrop,
              dropMinusGrab: grabDrop ? { x: x - grabDrop.x, y: y - grabDrop.y } : null,
              predictedTL,
              grabPointError,
              geom,
              vv: debugStockFreeViewport(),
            },
          });
          stockFreeGrabRef.current = null;
          setStockGrabScreen(null);
        }
        // #endregion
        if (stockDrag.kind === 'page') {
          for (const action of placeStockPage(
            stockDrag.pageId,
            x,
            y,
            present.rasterWidth,
            present.rasterHeight,
          )) {
            dispatchRef.current(action);
          }
        } else if (stockDrag.kind === 'clip') {
          dispatchRef.current({ type: 'placeStockClip', clipId: stockDrag.clipId, x, y });
        } else {
          dispatchRef.current({ type: 'placeStockText', textId: stockDrag.textId, x, y });
        }
      }
      setDraggedStockPageId(null);
      setDragPointer(null);
      return;
    }

    if (stockDrag && workspaceSurface) {
      const workspaceRect = workspaceSurface.getBoundingClientRect();
      const world = clientToWorkspaceWorld(
        clientX,
        clientY,
        workspaceRect,
        present.workspacePanX,
        present.workspacePanY,
        present.workspaceZoom,
      );
      if (world) {
        if (stockDrag.kind === 'page') {
          const readingIndex = resolveWorkspaceInsertIndex(
            clientX,
            clientY,
            workspaceRect,
            present.workspaceOrder,
            present.workspacePanX,
            present.workspacePanY,
            present.workspaceZoom,
            present,
          );
          if (readingIndex !== null) {
            const restore =
              present.stockPane === 'trash'
                ? returnTrashPageToWorkspace
                : returnStockPageToWorkspace;
            for (const action of restore(
              stockDrag.pageId,
              readingIndex,
              present.rasterWidth,
              present.rasterHeight,
            )) {
              dispatchRef.current(action);
            }
          }
        } else if (stockDrag.kind === 'clip') {
          dispatchRef.current({
            type: present.stockPane === 'trash' ? 'returnTrashClip' : 'returnStockClip',
            clipId: stockDrag.clipId,
            x: world.x,
            y: world.y,
          });
        } else {
          const text = present.pasteboardTexts.find((t) => t.id === stockDrag.textId);
          const frames = buildStripFrames(present.workspaceOrder, stripLayoutFromDoc(present)).frames;
          for (const action of returnStockTextToWorkspace({
            textId: stockDrag.textId,
            pointerWorldX: world.x,
            pointerWorldY: world.y,
            box: text?.box ?? { x: 0, y: 0, width: 4, height: 4 },
            fontSize: text?.fontSize ?? 12,
            frames,
            rasterWidth: present.rasterWidth,
            rasterHeight: present.rasterHeight,
            fromTrash: present.stockPane === 'trash',
          })) {
            dispatchRef.current(action);
          }
        }
        setDraggedStockPageId(null);
        setDragPointer(null);
        return;
      }

      if (stockSurface) {
        const stockRect = stockSurface.getBoundingClientRect();
        if (
          pointInRect(clientX, clientY, stockRect) &&
          present.stockLayout === 'free' &&
          present.stockPane !== 'trash'
        ) {
          const storedGrab = stockFreeGrabRef.current;
          const grabOffset =
            storedGrab && stockDragId && storedGrab.key === stockDragId
              ? { x: storedGrab.grabOffsetWorldX, y: storedGrab.grabOffsetWorldY }
              : undefined;
          const { x, y } = stockWorld(
            stockDrag.kind === 'page' ? pageThumbSize : itemThumbSize,
            grabOffset,
          );
          if (stockDrag.kind === 'page') {
            for (const action of placeStockPage(
              stockDrag.pageId,
              x,
              y,
              present.rasterWidth,
              present.rasterHeight,
            )) {
              dispatchRef.current(action);
            }
          } else if (stockDrag.kind === 'clip') {
            dispatchRef.current({ type: 'placeStockClip', clipId: stockDrag.clipId, x, y });
          } else {
            dispatchRef.current({ type: 'placeStockText', textId: stockDrag.textId, x, y });
          }
        }
      }
      setDraggedStockPageId(null);
      setDragPointer(null);
      return;
    }

    if (grab) {
      onWorkspaceGrabEndRef.current();
    }
  }, []);

  useEffect(() => {
    if (!workspaceGrab && !draggedStockPageId) {
      setTrashDropHover(false);
      setOverStockUi(false);
      return;
    }
    const onMove = (event: PointerEvent) => {
      setDragPointer({ x: event.clientX, y: event.clientY });
      const trashDrop = document.querySelector<HTMLElement>(`[${STOCK_TRASH_DROP_ATTR}]`);
      const overButton = trashDrop
        ? pointInRect(event.clientX, event.clientY, trashDrop.getBoundingClientRect())
        : false;
      const surface = surfaceRef.current;
      const overPane =
        docRef.current.stockPane === 'trash' &&
        surface != null &&
        pointInRect(event.clientX, event.clientY, surface.getBoundingClientRect());
      setTrashDropHover(overButton || overPane);
      setOverStockUi(pointOverStockUi(event.clientX, event.clientY, surface));
    };
    document.addEventListener('pointermove', onMove);
    return () => {
      document.removeEventListener('pointermove', onMove);
      setTrashDropHover(false);
    };
  }, [workspaceGrab, draggedStockPageId]);

  useEffect(() => {
    if (!workspaceGrab && !draggedStockPageId) {
      return;
    }

    const onPointerEnd = (event: PointerEvent) => {
      finishCrossPaneDrop(event.clientX, event.clientY);
    };

    document.addEventListener('pointerup', onPointerEnd, true);
    document.addEventListener('pointercancel', onPointerEnd, true);
    return () => {
      document.removeEventListener('pointerup', onPointerEnd, true);
      document.removeEventListener('pointercancel', onPointerEnd, true);
    };
  }, [workspaceGrab, draggedStockPageId, finishCrossPaneDrop]);

  const dragGhostKeys = stockDragGhostKeys(workspaceGrab, draggedStockPageId, overStockUi);

  const confirmStockItemDelete = (key: string) => {
    const parsed = parseStockThumbKey(key);
    if (parsed?.kind === 'page') {
      onDeletePage?.(parsed.pageId);
      return;
    }
    if (parsed?.kind === 'clip') {
      dispatch({ type: 'deleteStockClip', clipId: parsed.clipId });
      setStockDeleteKey(null);
      return;
    }
    if (parsed?.kind === 'text') {
      dispatch({ type: 'deleteStockText', textId: parsed.textId });
      setStockDeleteKey(null);
    }
  };

  const stockItemChrome = (key: string) => {
    const parsed = parseStockThumbKey(key);
    const show =
      parsed?.kind === 'page'
        ? Boolean(deletePageId === parsed.pageId && onDeletePage)
        : stockDeleteKey === key;
    if (!show) {
      return null;
    }
    return <PageChromeButtons onDelete={() => confirmStockItemDelete(key)} />;
  };

  const gridThumbMin = Math.max(GRID_THUMB_MIN_PX, GRID_THUMB_BASE_PX * doc.stockZoom);
  const pageAspect =
    doc.rasterWidth > 0 ? doc.rasterHeight / doc.rasterWidth : PAGE_DISPLAY_H / PAGE_DISPLAY_W;

  if (paneLayout === 'grid') {
    return (
      <div ref={surfaceRef} className={`${styles.stockSurface} ${styles.stockGridScroll}`}>
        <div
          className={styles.stockGrid}
          style={{
            ['--ms-stock-thumb-min' as string]: `${gridThumbMin}px`,
            ['--ms-page-aspect' as string]: String(pageAspect),
          }}
        >
        {paneItems.map((item) => {
          const key = stockThumbKey(item);
          const dragging = draggedStockPageId === key;
          if (isStockClipItem(item)) {
            const clip = doc.pasteboardClips.find((c) => c.id === item.clipId);
            return (
              <div
                key={key}
                data-stock-item-key={key}
                className={`${styles.stockThumb} ${styles.stockThumbClip} ${dragging ? styles.stockThumbDragging : ''}`}
                title={`クリップ ${item.clipId.slice(0, 8)}`}
              >
                <div className={styles.stockClipPad}>
                  <StockPageThumb
                    pageId={item.clipId}
                    rasterId={clip?.rasterId}
                    texts={EMPTY_TEXTS}
                    rasterWidth={doc.rasterWidth}
                    rasterHeight={doc.rasterHeight}
                    inkEngine={inkEngine}
                  />
                </div>
                {stockItemChrome(key)}
              </div>
            );
          }
          if (isStockTextItem(item)) {
            const text = doc.pasteboardTexts.find((t) => t.id === item.textId);
            return (
              <div
                key={key}
                data-stock-item-key={key}
                className={`${styles.stockThumb} ${styles.stockThumbText} ${dragging ? styles.stockThumbDragging : ''}`}
                title={`テキスト ${item.textId.slice(0, 8)}`}
              >
                <div className={styles.stockClipPad}>
                  <StockTextThumb
                    content={text?.content ?? ''}
                    color={text?.color ?? '#1A1A1A'}
                  />
                </div>
                {stockItemChrome(key)}
              </div>
            );
          }
          const pageId = item.pageId;
          if (!pageId) {
            return null;
          }
          return (
          <div
            key={key}
            data-stock-item-key={key}
            data-stock-page-id={pageId}
            className={`${styles.stockThumb} ${dragging ? styles.stockThumbDragging : ''}`}
            title={`${trashPane ? 'ゴミ箱' : 'ストック'} ${pageId.slice(0, 8)}`}
          >
            <div
              className={styles.stockPagePad}
              style={{ backgroundImage: `url(${PAGE_TEMPLATE_URL})` }}
            >
              <StockPageThumb
                pageId={pageId}
                rasterId={doc.pages[pageId]?.rasterId}
                texts={doc.pages[pageId]?.texts ?? EMPTY_TEXTS}
                rasterWidth={doc.rasterWidth}
                rasterHeight={doc.rasterHeight}
                inkEngine={inkEngine}
              />
            </div>
            {stockItemChrome(key)}
          </div>
          );
        })}
        {dragPointer
          ? dragGhostKeys.map((itemKey, index) => (
              <StockItemDragGhost
                key={itemKey}
                itemKey={itemKey}
                clientX={dragPointer.x + index * 12}
                clientY={dragPointer.y + index * 12}
                grabOffset={
                  stockGrabScreen && stockGrabScreen.key === itemKey
                    ? { x: stockGrabScreen.x, y: stockGrabScreen.y }
                    : undefined
                }
                doc={doc}
                inkEngine={inkEngine}
                getPageThumb={getPageThumb}
              />
            ))
          : null}
        </div>
      </div>
    );
  }

  return (
    <div ref={surfaceRef} className={styles.stockSurface}>
      <div
        ref={transformRef}
        className={styles.stockTransform}
        style={{
          transformOrigin: '0 0',
          position: 'relative',
          width: '100%',
          height: '100%',
        }}
      >
        {paneItems.map((item) => {
          const key = stockThumbKey(item);
          const dragging = draggedStockPageId === key;
          const freeStyle = { left: item.x, top: item.y } as const;
          if (isStockClipItem(item)) {
            const clip = doc.pasteboardClips.find((c) => c.id === item.clipId);
            return (
              <div
                key={key}
                data-stock-item-key={key}
                className={`${styles.stockThumbFree} ${styles.stockThumbClip} ${dragging ? styles.stockThumbDragging : ''}`}
                style={freeStyle}
                title={`クリップ ${item.clipId.slice(0, 8)}`}
              >
                <div className={styles.stockClipPad}>
                  <StockPageThumb
                    pageId={item.clipId}
                    rasterId={clip?.rasterId}
                    texts={EMPTY_TEXTS}
                    rasterWidth={doc.rasterWidth}
                    rasterHeight={doc.rasterHeight}
                    inkEngine={inkEngine}
                  />
                </div>
                {stockItemChrome(key)}
              </div>
            );
          }
          if (isStockTextItem(item)) {
            const text = doc.pasteboardTexts.find((t) => t.id === item.textId);
            return (
              <div
                key={key}
                data-stock-item-key={key}
                className={`${styles.stockThumbFree} ${styles.stockThumbText} ${dragging ? styles.stockThumbDragging : ''}`}
                style={freeStyle}
                title={`テキスト ${item.textId.slice(0, 8)}`}
              >
                <div className={styles.stockClipPad}>
                  <StockTextThumb
                    content={text?.content ?? ''}
                    color={text?.color ?? '#1A1A1A'}
                  />
                </div>
                {stockItemChrome(key)}
              </div>
            );
          }
          const pageId = item.pageId;
          if (!pageId) {
            return null;
          }
          return (
          <div
            key={key}
            data-stock-item-key={key}
            data-stock-page-id={pageId}
            className={`${styles.stockThumbFree} ${dragging ? styles.stockThumbDragging : ''}`}
            style={freeStyle}
            title={`ストック ${pageId.slice(0, 8)}`}
          >
            <div
              className={styles.stockPagePad}
              style={{ backgroundImage: `url(${PAGE_TEMPLATE_URL})` }}
            >
              <StockPageThumb
                pageId={pageId}
                rasterId={doc.pages[pageId]?.rasterId}
                texts={doc.pages[pageId]?.texts ?? EMPTY_TEXTS}
                rasterWidth={doc.rasterWidth}
                rasterHeight={doc.rasterHeight}
                inkEngine={inkEngine}
              />
            </div>
            {stockItemChrome(key)}
          </div>
          );
        })}
      </div>
      {dragPointer
        ? dragGhostKeys.map((itemKey, index) => (
            <StockItemDragGhost
              key={itemKey}
              itemKey={itemKey}
              clientX={dragPointer.x + index * 12}
              clientY={dragPointer.y + index * 12}
              grabOffset={
                stockGrabScreen && stockGrabScreen.key === itemKey
                  ? { x: stockGrabScreen.x, y: stockGrabScreen.y }
                  : undefined
              }
              doc={doc}
              inkEngine={inkEngine}
              getPageThumb={getPageThumb}
            />
          ))
        : null}
    </div>
  );
}