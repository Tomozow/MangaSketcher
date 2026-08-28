'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pointerKindFromWeb } from '@/src/input/pointerEvents';
import { joinVerticalBody } from '@/src/domain/pdfText';
import { selectPdfBodyRange, viewRectToPdf } from '@/src/domain/pdfLayout';
import { pdfPageViewerKey } from '@/src/domain/pdfView';
import type { PdfTextItem, Rect } from '@/src/domain/types';
import styles from '@/src/web/editor.module.css';
import { LONG_PRESS_MS } from './constants';
import {
  cancelPdfRangeForPinch,
  clearPdfPendingRange,
  createPdfGestureStore,
  stepPdfLongPressTimer,
  stepPdfPointer,
  type PdfGestureStore,
} from './pdfGestureFsm';
import { computeLetterbox } from './pdfLetterbox';
import { renderPdfPageToCanvas } from './pdfRender';
import { getOrLoadPdfProxy } from './pdfSession';

export type PdfPageViewerProps = {
  opfsPath: string;
  generation: number;
  currentPage: number;
  pageCount: number;
  zoom: number;
  panX: number;
  panY: number;
  pdfBytes: ArrayBuffer;
  sourceTextByPage: Record<number, PdfTextItem[]>;
  mediaWidth: number;
  mediaHeight: number;
  onViewChange?: (patch: {
    currentPage?: number;
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
  onDropTextRange?: (payload: {
    pdfPage: number;
    range: Rect;
    preview: string;
  }) => void;
};

function localPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

export function PdfPageViewer({
  opfsPath,
  generation,
  currentPage,
  pageCount,
  zoom,
  panX,
  panY,
  pdfBytes,
  sourceTextByPage,
  mediaWidth,
  mediaHeight,
  onViewChange,
  onDropTextRange,
}: PdfPageViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<PdfGestureStore>(createPdfGestureStore());
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDistance: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const [rangePreview, setRangePreview] = useState<Rect | null>(null);
  const [livePinchScale, setLivePinchScale] = useState(1);
  const livePinchScaleRef = useRef(1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const viewerKey = pdfPageViewerKey(opfsPath, currentPage, generation);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) {
      return;
    }

    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    void (async () => {
      try {
        setRenderError(null);
        const proxy = await getOrLoadPdfProxy(opfsPath, generation, pdfBytes);
        if (cancelled) {
          return;
        }
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const task = await renderPdfPageToCanvas(proxy, currentPage, canvas, {
          containerWidth: viewport.clientWidth,
          containerHeight: viewport.clientHeight,
          zoom,
          dpr,
        });
        if (cancelled) {
          task?.cancel();
          return;
        }
        renderTask = task;
        await task?.promise;
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'PDF render failed');
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [viewerKey, opfsPath, generation, currentPage, pdfBytes, zoom]);

  const applyGestureEffects = useCallback(
    (effects: ReturnType<typeof stepPdfPointer>) => {
      for (const effect of effects) {
        if (effect.type === 'pdfPan') {
          onViewChange?.({ panX: effect.panX, panY: effect.panY });
        } else if (effect.type === 'pdfRangePreview') {
          setRangePreview(effect.rect);
        } else if (effect.type === 'pdfRangeCommit') {
          setRangePreview(null);
          const source = sourceTextByPage[currentPage] ?? [];
          const canvas = canvasRef.current;
          const viewW = Math.max(1, canvas?.clientWidth ?? mediaWidth);
          const viewH = Math.max(1, canvas?.clientHeight ?? mediaHeight);
          const media = { width: mediaWidth, height: mediaHeight };
          const selected = selectPdfBodyRange(
            source,
            effect.rect,
            viewW,
            viewH,
            media,
            zoom,
            panX,
            panY,
          );
          const preview = joinVerticalBody(selected);
          if (preview.length > 0) {
            const pdfRange = viewRectToPdf(effect.rect, viewW, viewH, media, zoom, panX, panY);
            onDropTextRange?.({
              pdfPage: currentPage,
              range: pdfRange,
              preview,
            });
          }
          clearPdfPendingRange(gestureRef.current);
        } else if (effect.type === 'pdfRangeCancel' || effect.type === 'cancelRangeForPinch') {
          setRangePreview(null);
          clearPdfPendingRange(gestureRef.current);
        }
      }
    },
    [currentPage, mediaHeight, mediaWidth, onDropTextRange, onViewChange, panX, panY, sourceTextByPage, zoom],
  );

  const commitPinch = useCallback(() => {
    const pinch = pinchRef.current;
    if (!pinch) {
      return;
    }
    const nextZoom = Math.max(0.25, Math.min(8, pinch.startZoom * livePinchScaleRef.current));
    onViewChange?.({ zoom: nextZoom, panX, panY });
    pinchRef.current = null;
    livePinchScaleRef.current = 1;
    setLivePinchScale(1);
  }, [onViewChange, panX, panY]);

  const updatePinch = useCallback(() => {
    const points = [...pointersRef.current.values()];
    if (points.length < 2 || !pinchRef.current) {
      return;
    }
    const [a, b] = points;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (pinchRef.current.startDistance <= 0) {
      return;
    }
    setLivePinchScale(distance / pinchRef.current.startDistance);
    livePinchScaleRef.current = distance / pinchRef.current.startDistance;
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'pen') {
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = localPoint(canvas, event.clientX, event.clientY);
      pointersRef.current.set(event.pointerId, point);

      if (pointersRef.current.size >= 2) {
        clearLongPressTimer();
        gestureRef.current.session = null;
        applyGestureEffects(cancelPdfRangeForPinch(gestureRef.current));
        const points = [...pointersRef.current.values()];
        const [a, b] = points;
        pinchRef.current = {
          startDistance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          startZoom: zoom,
          startPanX: panX,
          startPanY: panY,
        };
        return;
      }

      if (event.isPrimary) {
        const now = performance.now();
        const effects = stepPdfPointer(gestureRef.current, {
          pointerId: event.pointerId,
          kind: pointerKindFromWeb({ pointerType: event.pointerType }),
          phase: 'down',
          x: point.x,
          y: point.y,
          now,
          panX,
          panY,
        });
        applyGestureEffects(effects);
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => {
          const tickEffects = stepPdfLongPressTimer(gestureRef.current, performance.now());
          applyGestureEffects(tickEffects);
        }, LONG_PRESS_MS);
      }
    },
    [applyGestureEffects, clearLongPressTimer, panX, panY, zoom],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'pen') {
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const point = localPoint(canvas, event.clientX, event.clientY);
      if (pointersRef.current.has(event.pointerId)) {
        pointersRef.current.set(event.pointerId, point);
      }

      if (pointersRef.current.size >= 2) {
        updatePinch();
        return;
      }

      const effects = stepPdfPointer(gestureRef.current, {
        pointerId: event.pointerId,
        kind: pointerKindFromWeb({ pointerType: event.pointerType }),
        phase: 'move',
        x: point.x,
        y: point.y,
        now: performance.now(),
        panX,
        panY,
      });
      if (effects.some((effect) => effect.type === 'pdfPan' || effect.type === 'pdfRangePreview')) {
        clearLongPressTimer();
      }
      applyGestureEffects(effects);
    },
    [applyGestureEffects, clearLongPressTimer, panX, panY, updatePinch],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      clearLongPressTimer();
      if (event.pointerType === 'pen') {
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const hadPinch = Boolean(pinchRef.current);
      pointersRef.current.delete(event.pointerId);

      if (hadPinch && pointersRef.current.size < 2) {
        commitPinch();
        return;
      }

      const point = localPoint(canvas, event.clientX, event.clientY);
      const effects = stepPdfPointer(gestureRef.current, {
        pointerId: event.pointerId,
        kind: pointerKindFromWeb({ pointerType: event.pointerType }),
        phase: 'up',
        x: point.x,
        y: point.y,
        now: performance.now(),
        panX,
        panY,
      });
      applyGestureEffects(effects);
    },
    [applyGestureEffects, clearLongPressTimer, commitPinch, panX, panY],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      clearLongPressTimer();
      pointersRef.current.delete(event.pointerId);
      if (pinchRef.current && pointersRef.current.size < 2) {
        commitPinch();
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const point = localPoint(canvas, event.clientX, event.clientY);
      applyGestureEffects(
        stepPdfPointer(gestureRef.current, {
          pointerId: event.pointerId,
          kind: pointerKindFromWeb({ pointerType: event.pointerType }),
          phase: 'cancel',
          x: point.x,
          y: point.y,
          now: performance.now(),
          panX,
          panY,
        }),
      );
    },
    [applyGestureEffects, clearLongPressTimer, commitPinch, panX, panY],
  );

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  const letterbox = computeLetterbox(
    viewportRef.current?.clientWidth ?? 400,
    viewportRef.current?.clientHeight ?? 300,
    mediaWidth,
    mediaHeight,
  );

  const goPage = (delta: number) => {
    const next = Math.min(pageCount, Math.max(1, currentPage + delta));
    if (next !== currentPage) {
      onViewChange?.({ currentPage: next });
    }
  };

  return (
    <div className={styles.pdfPaneInner}>
      <div className={styles.pdfNav}>
        <button type="button" className={styles.pdfNavButton} onClick={() => goPage(-1)} disabled={currentPage <= 1}>
          前
        </button>
        <span className={styles.pdfNavLabel}>
          {currentPage} / {pageCount}
        </span>
        <button
          type="button"
          className={styles.pdfNavButton}
          onClick={() => goPage(1)}
          disabled={currentPage >= pageCount}
        >
          次
        </button>
      </div>
      <div
        ref={viewportRef}
        className={styles.pdfViewport}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div
          className={styles.pdfTransform}
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom * livePinchScale})`,
            left: letterbox.offsetX,
            top: letterbox.offsetY,
          }}
        >
          <canvas ref={canvasRef} className={styles.pdfCanvas} key={viewerKey} />
          {rangePreview ? (
            <div
              className={styles.pdfRangeOverlay}
              style={{
                left: rangePreview.x,
                top: rangePreview.y,
                width: rangePreview.width,
                height: rangePreview.height,
              }}
            />
          ) : null}
        </div>
        {renderError ? <div className={styles.pdfRenderError}>{renderError}</div> : null}
      </div>
    </div>
  );
}
