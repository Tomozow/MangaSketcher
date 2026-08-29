'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from '@/src/domain/stripGeometry';
import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { PageDragThumbnail } from '@/src/web/PageDragThumbnail';
import { PageChromeButtons } from '@/src/web/PageDeleteButton';
import { PageThumbLayers } from '@/src/web/PageThumbLayers';
import {
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

export type WorkspaceGrab = {
  pageId: PageId;
  fromIndex: number;
};

export type StockPaneProps = {
  doc: EditorDocument;
  dispatch: (action: EditorDocumentAction) => void;
  workspaceGrab: WorkspaceGrab | null;
  onWorkspaceGrabEnd: () => void;
  getPageThumb?: (pageId: PageId) => ImageBitmap | undefined;
  inkEngine?: InkEngine | null;
  inkFrame?: number;
  deletePageId?: PageId | null;
  onShowPageDelete?: (pageId: PageId | null) => void;
  onDeletePage?: (pageId: PageId) => void;
};

function StockPageThumb({
  pageId,
  rasterId,
  texts,
  rasterWidth,
  rasterHeight,
  inkEngine,
  getPageThumb,
  inkFrame,
}: {
  pageId: PageId;
  rasterId?: string;
  texts: readonly PageText[];
  rasterWidth: number;
  rasterHeight: number;
  inkEngine?: InkEngine | null;
  getPageThumb?: (pageId: PageId) => ImageBitmap | undefined;
  inkFrame: number;
}) {
  const [thumb, setThumb] = useState<ImageBitmap | undefined>(() => getPageThumb?.(pageId));

  useEffect(() => {
    const existing = getPageThumb?.(pageId);
    if (existing) {
      setThumb(existing);
      return;
    }
    if (!rasterId || !inkEngine) {
      setThumb(undefined);
      return;
    }
    let cancelled = false;
    void inkEngine.generateThumb(rasterId).then((bitmap) => {
      if (!cancelled) {
        setThumb(bitmap ?? getPageThumb?.(pageId));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pageId, rasterId, inkEngine, getPageThumb, inkFrame]);

  return (
    <PageThumbLayers
      pageId={pageId}
      thumb={thumb}
      texts={texts}
      rasterWidth={rasterWidth}
      rasterHeight={rasterHeight}
    />
  );
}

export function StockPane({
  doc,
  dispatch,
  workspaceGrab,
  onWorkspaceGrabEnd,
  getPageThumb,
  inkEngine,
  inkFrame = 0,
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

    const stockDragId = pipelineRef.current ? getStockDragPageId(pipelineRef.current.store) : null;
    const grab = workspaceGrabRef.current;

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
    if (!workspaceGrab) {
      return;
    }
    const onMove = (event: PointerEvent) => {
      setDragPointer({ x: event.clientX, y: event.clientY });
    };
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, [workspaceGrab]);

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
            title={`${trashPane ? 'ゴミ箱' : 'ストック'} ${item.pageId.slice(0, 8)}`}
          >
            <StockPageThumb
              pageId={item.pageId}
              rasterId={doc.pages[item.pageId]?.rasterId}
              texts={doc.pages[item.pageId]?.texts ?? []}
              rasterWidth={doc.rasterWidth}
              rasterHeight={doc.rasterHeight}
              inkEngine={inkEngine}
              getPageThumb={getPageThumb}
              inkFrame={inkFrame}
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
            texts={doc.pages[dragPageId]?.texts ?? []}
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
            }}
            title={`ストック ${item.pageId.slice(0, 8)}`}
          >
            <StockPageThumb
              pageId={item.pageId}
              rasterId={doc.pages[item.pageId]?.rasterId}
              texts={doc.pages[item.pageId]?.texts ?? []}
              rasterWidth={doc.rasterWidth}
              rasterHeight={doc.rasterHeight}
              inkEngine={inkEngine}
              getPageThumb={getPageThumb}
              inkFrame={inkFrame}
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
          texts={doc.pages[dragPageId]?.texts ?? []}
          rasterWidth={doc.rasterWidth}
          rasterHeight={doc.rasterHeight}
        />
      ) : null}
    </div>
  );
}