'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
} from '@/src/web/stock/stockCoords';
import { reduceStockEffects } from '@/src/web/stock/stockEffects';
import { createStockPointerPipeline, getStockDragPageId } from '@/src/web/stock/stockPointer';
import { fitStockTextThumbFontSize, STOCK_TEXT_THUMB_BASE_PX } from '@/src/web/stock/stockTextThumbFit';
import type { StockHit } from '@/src/web/stock/types';
import { styles } from './editorStyles';

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
      const maxEdge = 320;
      const scale = Math.min(2, maxEdge / Math.max(cssW, cssH));
      const pixelW = Math.max(1, Math.round(cssW * scale));
      const pixelH = Math.max(1, Math.round(cssH * scale));
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      inkEngine.paintDisplay(ctx, rasterId, pixelW, pixelH);
      if (texts.length > 0 && rasterWidth > 0 && rasterHeight > 0) {
        drawPageTextsOnThumb(ctx, texts, rasterWidth, rasterHeight, pixelW, pixelH);
      }
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pixelW, pixelH);
      ctx.globalCompositeOperation = 'source-over';
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
  const [stockDeleteKey, setStockDeleteKey] = useState<string | null>(null);

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
    const stockDrag = stockDragId ? parseStockThumbKey(stockDragId) : null;
    const grab = workspaceGrabRef.current;
    const overTrashButton = trashDrop ? pointInRect(clientX, clientY, trashDrop.getBoundingClientRect()) : false;
    const overTrashPane =
      present.stockPane === 'trash' &&
      stockSurface != null &&
      pointInRect(clientX, clientY, stockSurface.getBoundingClientRect());
    const overTrash = overTrashButton || overTrashPane;

    const stockWorld = () => {
      if (!stockSurface) {
        return { x: 0, y: 0 };
      }
      const stockRect = stockSurface.getBoundingClientRect();
      return clientToStockWorld(
        clientX,
        clientY,
        stockRect,
        present.stockPanX,
        present.stockPanY,
        present.stockZoom,
        present.stockLayout,
      );
    };

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
      const { x, y } = stockWorld();
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
      const targetKey = stockDropTargetKey(clientX, clientY, stockDragId);
      if (targetKey) {
        const fromIndex = stockIndexByKey(present.stock, stockDragId);
        const toIndex = stockIndexByKey(present.stock, targetKey);
        if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
          dispatchRef.current({
            type: present.stockLayout === 'grid' ? 'reorderStock' : 'swapStockPositions',
            fromIndex,
            toIndex,
          });
          setDraggedStockPageId(null);
          setDragPointer(null);
          return;
        }
      }
      if (present.stockLayout === 'free') {
        const { x, y } = stockWorld();
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
          const { x, y } = clientToStockWorld(
            clientX,
            clientY,
            stockRect,
            present.stockPanX,
            present.stockPanY,
            present.stockZoom,
            present.stockLayout,
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
      <div
        ref={surfaceRef}
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
                    rasterLayoutGen={rasterLayoutGen}
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
                rasterLayoutGen={rasterLayoutGen}
              />
            </div>
            {stockItemChrome(key)}
          </div>
          );
        })}
        {dragPageId && dragPointer && !dragPageId.startsWith('clip:') && !dragPageId.startsWith('text:') ? (
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
                    rasterLayoutGen={rasterLayoutGen}
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
                rasterLayoutGen={rasterLayoutGen}
              />
            </div>
            {stockItemChrome(key)}
          </div>
          );
        })}
      </div>
      {dragPageId && dragPointer && !dragPageId.startsWith('clip:') && !dragPageId.startsWith('text:') ? (
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