'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pointerKindFromWeb, isPencilHover } from '@/src/input/pointerEvents';
import {
  joinVerticalBody,
  sanitizeExtractedBody,
  sliceReadingRange,
  snapReadingRangeToLines,
  sortBodyReadingOrder,
} from '@/src/domain/pdfText';
import {
  hitBodyReadingIndex,
  isExtractedGlyph,
  pdfItemToView,
  unionPdfItems,
} from '@/src/domain/pdfLayout';
import { pdfPageViewerKey } from '@/src/domain/pdfView';
import type { PdfExtractedGlyph, PdfTextItem, Rect } from '@/src/domain/types';
import { styles } from '@/src/web/editorStyles';
import { PDF_MAX_EDGE, PDF_SHARP_MAX_EDGE } from './constants';
import {
  cancelPdfSelectionForPinch,
  clearPdfSelection,
  createPdfGestureStore,
  stepPdfPointer,
  type PdfGestureStore,
  type PdfPointerInput,
  type PdfSelection,
} from './pdfGestureFsm';
import { computeLetterbox } from './pdfLetterbox';
import { renderPdfPageToCanvas } from './pdfRender';
import { getOrLoadPdfProxy } from './pdfSession';

const TOUCH_HIT_SLOP_PX = 24;

function isPdfAdjustMode(mode: string | null | undefined): boolean {
  return mode === 'adjustStart' || mode === 'adjustEnd';
}

export type PdfExtractPayload = {
  pdfPage: number;
  range: Rect;
  preview: string;
  glyphs: Array<{ x: number; y: number; width: number; height: number }>;
};

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
  extractedGlyphs?: PdfExtractedGlyph[];
  extractMarkersVisible?: boolean;
  extractSanitizePunctuation?: boolean;
  mediaWidth: number;
  mediaHeight: number;
  onViewChange?: (patch: {
    currentPage?: number;
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
  onExtractText?: (payload: PdfExtractPayload) => void;
  onToggleExtractMarkers?: (visible: boolean) => void;
  onToggleExtractSanitizePunctuation?: (enabled: boolean) => void;
  navExtra?: ReactNode;
};

function canvasScreenPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function canvasLocalFromScreen(
  screen: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  const s = Math.max(0.01, scale);
  return { x: screen.x / s, y: screen.y / s };
}

function handleAtPoint(
  x: number,
  y: number,
  startRect: Rect,
  endRect: Rect,
  radius: number,
): 'start' | 'end' | null {
  const start = { x: startRect.x + startRect.width / 2, y: startRect.y };
  const end = { x: endRect.x + endRect.width / 2, y: endRect.y + endRect.height };
  if (Math.hypot(x - start.x, y - start.y) <= radius) {
    return 'start';
  }
  if (Math.hypot(x - end.x, y - end.y) <= radius) {
    return 'end';
  }
  return null;
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
  extractedGlyphs = [],
  extractMarkersVisible = true,
  extractSanitizePunctuation = false,
  mediaWidth,
  mediaHeight,
  onViewChange,
  onExtractText,
  onToggleExtractMarkers,
  onToggleExtractSanitizePunctuation,
  navExtra,
}: PdfPageViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<PdfGestureStore>(createPdfGestureStore());
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDistance: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [livePinchScale, setLivePinchScale] = useState(1);
  const livePinchScaleRef = useRef(1);
  const [livePanX, setLivePanX] = useState(panX);
  const [livePanY, setLivePanY] = useState(panY);
  const livePanXRef = useRef(panX);
  const livePanYRef = useRef(panY);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [buttonPos, setButtonPos] = useState<{ left: number; top: number } | null>(null);
  const viewerKey = pdfPageViewerKey(opfsPath, currentPage, generation);
  const media = useMemo(
    () => ({ width: mediaWidth, height: mediaHeight }),
    [mediaWidth, mediaHeight],
  );
  const pinchScale = livePinchScale;

  useEffect(() => {
    livePanXRef.current = panX;
    livePanYRef.current = panY;
    setLivePanX(panX);
    setLivePanY(panY);
  }, [viewerKey]);

  const clearSelection = useCallback(() => {
    clearPdfSelection(gestureRef.current);
    setSelection(null);
    setButtonPos(null);
  }, []);

  useEffect(() => {
    clearSelection();
  }, [clearSelection, currentPage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) {
      return;
    }

    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    const paint = async (maxEdge: number) => {
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
        maxEdge,
      });
      if (cancelled) {
        task?.cancel();
        await task?.promise;
        return;
      }
      renderTask = task;
      await task?.promise;
    };

    void (async () => {
      try {
        setRenderError((prev) => (prev == null ? prev : null));
        await paint(PDF_MAX_EDGE);
        if (cancelled) {
          return;
        }
        await paint(PDF_SHARP_MAX_EDGE);
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

  const sortedBody = sortBodyReadingOrder(sourceTextByPage[currentPage] ?? []);
  const selectedItems =
    selection != null ? sliceReadingRange(sortedBody, selection.startIndex, selection.endIndex) : [];

  const applyGestureEffects = useCallback(
    (effects: ReturnType<typeof stepPdfPointer>) => {
      for (const effect of effects) {
        if (effect.type === 'pdfPan') {
          livePanXRef.current = effect.panX;
          livePanYRef.current = effect.panY;
          setLivePanX(effect.panX);
          setLivePanY(effect.panY);
        } else if (effect.type === 'pdfSelectionChange' || effect.type === 'pdfSelectionCommit') {
          setSelection({ startIndex: effect.startIndex, endIndex: effect.endIndex });
        } else if (effect.type === 'pdfSelectionClear') {
          setSelection(null);
          setButtonPos(null);
        } else if (effect.type === 'cancelSelectionForPinch') {
          // keep committed selection
        }
      }
    },
    [],
  );

  const dispatchPdfPointer = useCallback(
    (input: PdfPointerInput) => {
      const modeBefore = gestureRef.current.session?.mode;
      const effects = stepPdfPointer(gestureRef.current, input);
      const modeAfter = gestureRef.current.session?.mode;
      const adjusting = isPdfAdjustMode(modeBefore) || isPdfAdjustMode(modeAfter);
      const sorted = sortBodyReadingOrder(sourceTextByPage[currentPage] ?? []);
      const next = adjusting
        ? effects
        : effects.map((effect) => {
            if (effect.type !== 'pdfSelectionChange' && effect.type !== 'pdfSelectionCommit') {
              return effect;
            }
            const snapped = snapReadingRangeToLines(sorted, effect.startIndex, effect.endIndex);
            return { ...effect, startIndex: snapped.startIndex, endIndex: snapped.endIndex };
          });
      if (!adjusting) {
        for (const effect of next) {
          if (effect.type === 'pdfSelectionChange' || effect.type === 'pdfSelectionCommit') {
            gestureRef.current.selection = {
              startIndex: effect.startIndex,
              endIndex: effect.endIndex,
            };
          }
        }
      }
      applyGestureEffects(next);
    },
    [applyGestureEffects, currentPage, sourceTextByPage],
  );

  const resolveHit = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return {
          screen: { x: 0, y: 0 },
          local: { x: 0, y: 0 },
          hitIndex: null as number | null,
          handle: null as 'start' | 'end' | null,
        };
      }
      const screen = canvasScreenPoint(canvas, event.clientX, event.clientY);
      const local = canvasLocalFromScreen(screen, pinchScale);
      const viewW = Math.max(1, canvas.clientWidth);
      const viewH = Math.max(1, canvas.clientHeight);
      const handleRadius = 7;
      const slop = TOUCH_HIT_SLOP_PX / Math.max(0.01, pinchScale);
      const source = sourceTextByPage[currentPage] ?? [];
      const exactHit = hitBodyReadingIndex(source, local.x, local.y, viewW, viewH, media, 0);
      let handle: 'start' | 'end' | null = null;
      if (exactHit == null && selection && selectedItems.length > 0) {
        const first = pdfItemToView(selectedItems[0], viewW, viewH, media);
        const last = pdfItemToView(selectedItems[selectedItems.length - 1], viewW, viewH, media);
        handle = handleAtPoint(local.x, local.y, first, last, handleRadius);
      }
      const hitIndex =
        handle != null
          ? null
          : (exactHit ?? hitBodyReadingIndex(source, local.x, local.y, viewW, viewH, media, slop));
      return { screen, local, hitIndex, handle };
    },
    [currentPage, media, pinchScale, selectedItems, selection, sourceTextByPage],
  );

  const commitPinch = useCallback(() => {
    const pinch = pinchRef.current;
    if (!pinch) {
      return;
    }
    const nextZoom = Math.max(0.25, Math.min(8, pinch.startZoom * livePinchScaleRef.current));
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (canvas && viewport) {
      const box = computeLetterbox(
        viewport.clientWidth,
        viewport.clientHeight,
        mediaWidth,
        mediaHeight,
      );
      canvas.style.width = `${box.width * nextZoom}px`;
      canvas.style.height = `${box.height * nextZoom}px`;
    }
    pinchRef.current = null;
    livePinchScaleRef.current = 1;
    setLivePinchScale(1);
    onViewChange?.({
      zoom: nextZoom,
      panX: livePanXRef.current,
      panY: livePanYRef.current,
    });
  }, [mediaHeight, mediaWidth, onViewChange]);

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
      if (isPencilHover(event, pointerKindFromWeb(event))) {
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const hit = resolveHit(event);
      const client = { x: event.clientX, y: event.clientY };
      pointersRef.current.set(event.pointerId, client);

      if (pointersRef.current.size >= 2) {
        gestureRef.current.session = null;
        applyGestureEffects(cancelPdfSelectionForPinch(gestureRef.current));
        const points = [...pointersRef.current.values()];
        const [a, b] = points;
        pinchRef.current = {
          startDistance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          startZoom: zoom,
          startPanX: livePanXRef.current,
          startPanY: livePanYRef.current,
        };
        return;
      }

      if (event.isPrimary) {
        dispatchPdfPointer({
          pointerId: event.pointerId,
          kind: pointerKindFromWeb({ pointerType: event.pointerType }),
          phase: 'down',
          x: client.x,
          y: client.y,
          now: performance.now(),
          panX: livePanXRef.current,
          panY: livePanYRef.current,
          hitIndex: hit.hitIndex,
          handle: hit.handle,
        });
      }
    },
    [zoom, applyGestureEffects, dispatchPdfPointer, resolveHit],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isPencilHover(event, pointerKindFromWeb(event))) {
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const hit = resolveHit(event);
      const client = { x: event.clientX, y: event.clientY };
      if (pointersRef.current.has(event.pointerId)) {
        pointersRef.current.set(event.pointerId, client);
      }

      if (pointersRef.current.size >= 2) {
        updatePinch();
        return;
      }

      dispatchPdfPointer({
        pointerId: event.pointerId,
        kind: pointerKindFromWeb({ pointerType: event.pointerType }),
        phase: 'move',
        x: client.x,
        y: client.y,
        now: performance.now(),
        panX: livePanXRef.current,
        panY: livePanYRef.current,
        hitIndex: hit.hitIndex,
        handle: hit.handle,
      });
    },
    [dispatchPdfPointer, resolveHit, updatePinch],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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

      const hit = resolveHit(event);
      dispatchPdfPointer({
        pointerId: event.pointerId,
        kind: pointerKindFromWeb({ pointerType: event.pointerType }),
        phase: 'up',
        x: event.clientX,
        y: event.clientY,
        now: performance.now(),
        panX: livePanXRef.current,
        panY: livePanYRef.current,
        hitIndex: hit.hitIndex,
        handle: hit.handle,
      });
      onViewChange?.({ panX: livePanXRef.current, panY: livePanYRef.current });
    },
    [commitPinch, dispatchPdfPointer, onViewChange, resolveHit],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId);
      if (pinchRef.current && pointersRef.current.size < 2) {
        commitPinch();
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const hit = resolveHit(event);
      dispatchPdfPointer({
        pointerId: event.pointerId,
        kind: pointerKindFromWeb({ pointerType: event.pointerType }),
        phase: 'cancel',
        x: event.clientX,
        y: event.clientY,
        now: performance.now(),
        panX: livePanXRef.current,
        panY: livePanYRef.current,
        hitIndex: hit.hitIndex,
        handle: hit.handle,
      });
      onViewChange?.({ panX: livePanXRef.current, panY: livePanYRef.current });
    },
    [commitPinch, dispatchPdfPointer, onViewChange, resolveHit],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport || selectedItems.length === 0) {
      setButtonPos((prev) => (prev === null ? prev : null));
      return;
    }
    const viewW = Math.max(1, canvas.clientWidth);
    const viewH = Math.max(1, canvas.clientHeight);
    const canvasRect = canvas.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const item of selectedItems) {
      const rect = pdfItemToView(item, viewW, viewH, media);
      const sl = canvasRect.left + rect.x * pinchScale;
      const st = canvasRect.top + rect.y * pinchScale;
      left = Math.min(left, sl);
      top = Math.min(top, st);
      right = Math.max(right, sl + rect.width * pinchScale);
      bottom = Math.max(bottom, st + rect.height * pinchScale);
    }
    const localLeft = (left + right) / 2 - viewportRect.left - 40;
    let localTop = top - viewportRect.top - 48;
    if (localTop < 8) {
      localTop = bottom - viewportRect.top + 8;
    }
    const next = { left: Math.max(8, localLeft), top: Math.max(8, localTop) };
    setButtonPos((prev) =>
      prev && prev.left === next.left && prev.top === next.top ? prev : next,
    );
  }, [pinchScale, livePanX, livePanY, selection?.startIndex, selection?.endIndex, currentPage, mediaWidth, mediaHeight, sourceTextByPage]);

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

  const canvas = canvasRef.current;
  const viewW = Math.max(1, canvas?.clientWidth ?? letterbox.width);
  const viewH = Math.max(1, canvas?.clientHeight ?? letterbox.height);
  const handleRadius = 7;
  const firstSelectedRect =
    selectedItems.length > 0 ? pdfItemToView(selectedItems[0], viewW, viewH, media) : null;
  const lastSelectedRect =
    selectedItems.length > 0
      ? pdfItemToView(selectedItems[selectedItems.length - 1], viewW, viewH, media)
      : null;

  const extract = () => {
    if (selectedItems.length === 0) {
      return;
    }
    const joined = joinVerticalBody(selectedItems);
    const preview = extractSanitizePunctuation ? sanitizeExtractedBody(joined) : joined;
    const range = unionPdfItems(selectedItems);
    if (!preview || !range) {
      return;
    }
    onExtractText?.({
      pdfPage: currentPage,
      range,
      preview,
      glyphs: selectedItems.map((item) => ({
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      })),
    });
    clearSelection();
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
        <button
          type="button"
          className={styles.pdfNavButton}
          aria-pressed={extractMarkersVisible}
          onClick={() => onToggleExtractMarkers?.(!extractMarkersVisible)}
        >
          マーカー
        </button>
        <button
          type="button"
          className={styles.pdfNavButton}
          aria-pressed={extractSanitizePunctuation}
          title="「」を削除し、句読点を半角スペースにする"
          onClick={() => onToggleExtractSanitizePunctuation?.(!extractSanitizePunctuation)}
        >
          整形
        </button>
        {navExtra}
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
            transform: `translate(${livePanX}px, ${livePanY}px) scale(${pinchScale})`,
            left: letterbox.offsetX,
            top: letterbox.offsetY,
          }}
        >
          <canvas ref={canvasRef} className={styles.pdfCanvas} key={viewerKey} />
          {extractMarkersVisible
            ? sortedBody
                .filter((item) => isExtractedGlyph(item, currentPage, extractedGlyphs))
                .map((item, index) => {
                  const rect = pdfItemToView(item, viewW, viewH, media);
                  return (
                    <div
                      key={`m-${index}-${item.x}-${item.y}`}
                      className={styles.pdfGlyphMarker}
                      style={{
                        left: rect.x,
                        top: rect.y,
                        width: rect.width,
                        height: rect.height,
                      }}
                    />
                  );
                })
            : null}
          {selectedItems.map((item, index) => {
            const rect = pdfItemToView(item, viewW, viewH, media);
            return (
              <div
                key={`s-${index}-${item.x}-${item.y}`}
                className={styles.pdfGlyphSelect}
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            );
          })}
          {firstSelectedRect && lastSelectedRect ? (
            <>
              <div
                className={styles.pdfSelectHandle}
                style={{
                  left: firstSelectedRect.x + firstSelectedRect.width / 2 - handleRadius,
                  top: firstSelectedRect.y - handleRadius,
                  width: handleRadius * 2,
                  height: handleRadius * 2,
                }}
              />
              <div
                className={styles.pdfSelectHandle}
                style={{
                  left: lastSelectedRect.x + lastSelectedRect.width / 2 - handleRadius,
                  top: lastSelectedRect.y + lastSelectedRect.height - handleRadius,
                  width: handleRadius * 2,
                  height: handleRadius * 2,
                }}
              />
            </>
          ) : null}
        </div>
        {buttonPos && selectedItems.length > 0 ? (
          <button
            type="button"
            className={styles.pdfExtractButton}
            style={{ left: buttonPos.left, top: buttonPos.top }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              extract();
            }}
          >
            切り出し
          </button>
        ) : null}
        {renderError ? <div className={styles.pdfRenderError}>{renderError}</div> : null}
      </div>
    </div>
  );
}
