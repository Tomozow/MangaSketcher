'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from '@/src/domain/stripGeometry';
import type { PageId, PageText } from '@/src/domain/types';
import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { drawPageTextsOnThumb } from '@/src/web/ink/drawPageTextsOnThumb';
import { PageDragThumbnail } from '@/src/web/PageDragThumbnail';
import { PageChromeButtons } from '@/src/web/PageDeleteButton';
import { PAGE_TEMPLATE_URL } from '@/src/web/PageThumbLayers';
import {
  dropStockPageToTrash,
  dropWorkspacePageToTrash,
  moveWorkspacePageToStock,
  placeStockPage,
  returnStockPageToWorkspace,
  returnTrashPageToWorkspace,
} from '@/src/web/stock/stockActions';
import {
  clientToStockWorld,
  pointInRect,
  resolveWorkspaceInsertIndex,
} from '@/src/web/stock/stockCoords';
import { reduceStockEffects } from '@/src/web/stock/stockEffects';
import { createStockPointerPipeline, getStockDragPageId } from '@/src/web/stock/stockPointer';
import type { StockHit } from '@/src/web/stock/types';
import { styles } from './editorStyles';

const GRID_THUMB_BASE_PX = 112;
const GRID_THUMB_MIN_PX = 36;
const EMPTY_TEXTS: readonly PageText[] = [];

export const STOCK_TRASH_DROP_ATTR = 'data-stock-trash-drop';

function setTrashDropHover(on: boolean): void {
  document.querySelector(`[${STOCK_TRASH_DROP_ATTR}]`)?.toggleAttribute('data-drop-hover', on);
}

export type WorkspaceGrab = {
  pageId: PageId;
  fromIndex: number;
};

export type StockPaneProps = {
  doc: EditorDocument;
  dispatch: (action: EditorDocumentAction) => void;
  workspaceGrab: WorkspaceGrab | null;
  onWorkspaceGrabEnd: () => void;
  onDroppedToTrash?: () => void;
  getPageThumb?: (pageId: PageId) => ImageBitmap | undefined;
  inkEngine?: InkEngine | null;
  rasterLayoutGen?: number;
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
  rasterLayoutGen: number;
};

const StockPageThumb = memo(function StockPageThumb({
  pageId,
  rasterId,
  texts,
  rasterWidth,
  rasterHeight,
  inkEngine,
  rasterLayoutGen,
}: StockPageThumbProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas || !inkEngine || !rasterId) {
      return;
    }

    const paint = () => {
      const cssW = Math.max(1, Math.round(host.clientWidth));
      const cssH = Math.max(1, Math.round(host.clientHeight));
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const pixelW = Math.max(1, Math.round(cssW * dpr));
      const pixelH = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      inkEngine.paintDisplay(ctx, rasterId, cssW, cssH);
      if (texts.length > 0 && rasterWidth > 0 && rasterHeight > 0) {
        drawPageTextsOnThumb(ctx, texts, rasterWidth, rasterHeight, cssW, cssH);
      }
      try {
        host.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
        host.style.backgroundSize = '100% 100%';
        host.style.backgroundRepeat = 'no-repeat';
      } catch {
        /* toDataURL can throw if the canvas is tainted or empty */
      }
    };

    paint();
    const frame = requestAnimationFrame(paint);
    const observer = new ResizeObserver(paint);
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [inkEngine, rasterId, rasterWidth, rasterHeight, pageId, texts, rasterLayoutGen]);

  if (!inkEngine || !rasterId) {
    return null;
  }

  return (
    <div ref={hostRef} className={styles.stockThumbInkHost}>
      <canvas ref={canvasRef} className={styles.stockPageInk} aria-hidden />
    </div>
  );
}, (prev, next) => (
  prev.pageId === next.pageId &&
  prev.rasterId === next.rasterId &&
  prev.texts === next.texts &&
  prev.rasterWidth === next.rasterWidth &&
  prev.rasterHeight === next.rasterHeight &&
  prev.inkEngine === next.inkEngine &&
  prev.rasterLayoutGen === next.rasterLayoutGen
));

export function StockPane({
  doc,
  dispatch,
  workspaceGrab,
  onWorkspaceGrabEnd,
  onDroppedToTrash,
  getPageThumb,
  inkEngine,
  rasterLayoutGen = 0,
  deletePageId = null,
  onShowPageDelete,
  onDeletePage,
}: StockPaneProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pipelineRef = useRef<ReturnType<typeof createStockPointerPipeline> | null>(null);
  const [draggedStockPageId, setDraggedStockPageId] = useState<PageId | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);

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
    ? doc.trash.map((pageId) => ({ pageId, x: 0, y: 0 }))
    : doc.stock;

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
    const thumb = (target as HTMLElement).closest('[data-stock-page-id]');
    if (thumb) {
      const pageId = thumb.getAttribute('data-stock-page-id');
      if (pageId) {
        return { kind: 'thumb', pageId };
      }
    }
    return { kind: 'empty' };
  }, []);

  const applyStockEffects = useCallback(
    (effects: Parameters<typeof reduceStockEffects>[1]) => {
      const present = docRef.current;
      const pipeline = pipelineRef.current;
      if (!pipeline || effects.length === 0) {
        return;
      }
      const batch = reduceStockEffects(
        present,
        effects,
        pipeline.store.fingerPositions,
        surfaceRef.current?.getBoundingClientRect() ?? null,
      );
      if (batch.view) {
        if (present.stockLayout === 'grid' || present.stockPane === 'trash') {
          if (batch.view.zoom !== present.stockZoom) {
            dispatchRef.current({
              type: 'setStockView',
              zoom: batch.view.zoom,
              panX: present.stockPanX,
              panY: present.stockPanY,
            });
          }
          const surface = surfaceRef.current;
          if (surface) {
            surface.scrollLeft -= batch.view.panX - present.stockPanX;
            surface.scrollTop -= batch.view.panY - present.stockPanY;
          }
        } else {
          dispatchRef.current({
            type: 'setStockView',
            zoom: batch.view.zoom,
            panX: batch.view.panX,
            panY: batch.view.panY,
          });
        }
      }
      for (const action of batch.actions) {
        dispatchRef.current(action);
      }
      for (const effect of effects) {
        if (effect.type === 'showPageDelete' && present.stockPane !== 'trash') {
          onShowPageDeleteRef.current?.(effect.pageId);
        }
        if (effect.type === 'dragPage') {
          onShowPageDeleteRef.current?.(null);
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
    [syncDragPointer],
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
    surface.addEventListener('pointermove', onPointerMove);

    const unbind = pipeline.bind(surface);
    return () => {
      surface.removeEventListener('pointermove', onPointerMove);
      unbind();
      pipeline.reset();
      pipelineRef.current = null;
    };
  }, [applyStockEffects, resolveHit, syncDragPointer, paneLayout, trashPane]);

  const finishCrossPaneDrop = useCallback((clientX: number, clientY: number) => {
    const present = docRef.current;
    const stockSurface = surfaceRef.current;
    const workspaceSurface = document.querySelector(`.${styles.workspaceSurface}`) as HTMLElement | null;
    const trashDrop = document.querySelector<HTMLElement>(`[${STOCK_TRASH_DROP_ATTR}]`);

    const stockDragId = pipelineRef.current ? getStockDragPageId(pipelineRef.current.store) : null;
    const grab = workspaceGrabRef.current;
    const overTrashButton = trashDrop ? pointInRect(clientX, clientY, trashDrop.getBoundingClientRect()) : false;
    const overTrashPane =
      present.stockPane === 'trash' &&
      stockSurface != null &&
      pointInRect(clientX, clientY, stockSurface.getBoundingClientRect());
    const overTrash = overTrashButton || overTrashPane;

    if (overTrash && grab) {
      for (const action of dropWorkspacePageToTrash(grab.pageId)) {
        dispatchRef.current(action);
      }
      dispatchRef.current({ type: 'setUiLayout', stockPane: 'trash' });
      onDroppedToTrashRef.current?.();
      onWorkspaceGrabEndRef.current();
      setTrashDropHover(false);
      return;
    }

    if (overTrash && stockDragId && present.stockPane !== 'trash') {
      for (const action of dropStockPageToTrash(stockDragId)) {
        dispatchRef.current(action);
      }
      dispatchRef.current({ type: 'setUiLayout', stockPane: 'trash' });
      onDroppedToTrashRef.current?.();
      setDraggedStockPageId(null);
      setDragPointer(null);
      setTrashDropHover(false);
      return;
    }

    if (grab && stockSurface && present.stockPane !== 'trash') {
      const stockRect = stockSurface.getBoundingClientRect();
      if (pointInRect(clientX, clientY, stockRect)) {
        const { x, y } = clientToStockWorld(
          clientX,
          clientY,
          stockRect,
          present.stockPanX,
          present.stockPanY,
          present.stockZoom,
          present.stockLayout,
        );
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
        onWorkspaceGrabEndRef.current();
        return;
      }
    }

    if (stockDragId && workspaceSurface) {
      const workspaceRect = workspaceSurface.getBoundingClientRect();
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
          stockDragId,
          readingIndex,
          present.rasterWidth,
          present.rasterHeight,
        )) {
          dispatchRef.current(action);
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
          const { x, y } = clientToStockWorld(
            clientX,
            clientY,
            stockRect,
            present.stockPanX,
            present.stockPanY,
            present.stockZoom,
            present.stockLayout,
          );
          for (const action of placeStockPage(
            stockDragId,
            x,
            y,
            present.rasterWidth,
            present.rasterHeight,
          )) {
            dispatchRef.current(action);
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

  const dragPageId = workspaceGrab?.pageId ?? draggedStockPageId;

  const gridThumbMin = Math.max(GRID_THUMB_MIN_PX, GRID_THUMB_BASE_PX * doc.stockZoom);
  const pageAspect =
    doc.rasterWidth > 0 ? doc.rasterHeight / doc.rasterWidth : PAGE_DISPLAY_H / PAGE_DISPLAY_W;

  if (paneLayout === 'grid') {
    return (
      <div
        ref={surfaceRef}
        className={styles.stockGrid}
        style={{
          ['--ms-stock-thumb-min' as string]: `${gridThumbMin}px`,
          ['--ms-page-aspect' as string]: String(pageAspect),
        }}
      >
        {paneItems.map((item) => (
          <div
            key={item.pageId}
            data-stock-page-id={item.pageId}
            className={`${styles.stockThumb} ${draggedStockPageId === item.pageId ? styles.stockThumbDragging : ''}`}
            style={{ backgroundImage: `url(${PAGE_TEMPLATE_URL})` }}
            title={`${trashPane ? 'ゴミ箱' : 'ストック'} ${item.pageId.slice(0, 8)}`}
          >
            <StockPageThumb
              pageId={item.pageId}
              rasterId={doc.pages[item.pageId]?.rasterId}
              texts={doc.pages[item.pageId]?.texts ?? EMPTY_TEXTS}
              rasterWidth={doc.rasterWidth}
              rasterHeight={doc.rasterHeight}
              inkEngine={inkEngine}
              rasterLayoutGen={rasterLayoutGen}
            />
            {deletePageId === item.pageId && onDeletePage ? (
              <PageChromeButtons onDelete={() => onDeletePage(item.pageId)} />
            ) : null}
          </div>
        ))}
        {dragPageId && dragPointer ? (
          <PageDragThumbnail
            pageId={dragPageId}
            clientX={dragPointer.x}
            clientY={dragPointer.y}
            thumb={getPageThumb?.(dragPageId)}
            texts={doc.pages[dragPageId]?.texts ?? EMPTY_TEXTS}
            rasterWidth={doc.rasterWidth}
            rasterHeight={doc.rasterHeight}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div ref={surfaceRef} className={styles.stockSurface}>
      <div
        className={styles.stockTransform}
        style={{
          transform: `translate(${doc.stockPanX}px, ${doc.stockPanY}px) scale(${doc.stockZoom})`,
          transformOrigin: '0 0',
          position: 'relative',
          width: '100%',
          height: '100%',
        }}
      >
        {paneItems.map((item) => (
          <div
            key={item.pageId}
            data-stock-page-id={item.pageId}
            className={`${styles.stockThumbFree} ${draggedStockPageId === item.pageId ? styles.stockThumbDragging : ''}`}
            style={{
              left: item.x,
              top: item.y,
              backgroundImage: `url(${PAGE_TEMPLATE_URL})`,
            }}
            title={`ストック ${item.pageId.slice(0, 8)}`}
          >
            <StockPageThumb
              pageId={item.pageId}
              rasterId={doc.pages[item.pageId]?.rasterId}
              texts={doc.pages[item.pageId]?.texts ?? EMPTY_TEXTS}
              rasterWidth={doc.rasterWidth}
              rasterHeight={doc.rasterHeight}
              inkEngine={inkEngine}
              rasterLayoutGen={rasterLayoutGen}
            />
            {deletePageId === item.pageId && onDeletePage ? (
              <PageChromeButtons onDelete={() => onDeletePage(item.pageId)} />
            ) : null}
          </div>
        ))}
      </div>
      {dragPageId && dragPointer ? (
        <PageDragThumbnail
          pageId={dragPageId}
          clientX={dragPointer.x}
          clientY={dragPointer.y}
          thumb={getPageThumb?.(dragPageId)}
          texts={doc.pages[dragPageId]?.texts ?? EMPTY_TEXTS}
          rasterWidth={doc.rasterWidth}
          rasterHeight={doc.rasterHeight}
        />
      ) : null}
    </div>
  );
}