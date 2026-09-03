'use client';

import { useCallback, useRef } from 'react';
import { styles } from './editorStyles';

type SplitHandleProps = {
  orientation: 'horizontal' | 'vertical';
  onDrag: (deltaPx: number) => void;
};

export function SplitHandle({ orientation, onDrag }: SplitHandleProps) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      dragging.current = true;
      lastPos.current = orientation === 'horizontal' ? event.clientX : event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [orientation],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) {
        return;
      }
      const pos = orientation === 'horizontal' ? event.clientX : event.clientY;
      const delta = pos - lastPos.current;
      lastPos.current = pos;
      if (delta !== 0) {
        onDrag(delta);
      }
      event.preventDefault();
    },
    [onDrag, orientation],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      role="separator"
      aria-orientation={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
      className={orientation === 'horizontal' ? styles.splitHandleHorizontal : styles.splitHandleVertical}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}

type PdfDrawerResizeEdge = 'w' | 's' | 'sw' | 'e' | 'se' | 'n' | 'nw';

type PdfDrawerResizeHandleProps = {
  edge: PdfDrawerResizeEdge;
  onStart?: () => void;
  onPreview: (totalDx: number, totalDy: number) => void;
  onCommit: (totalDx: number, totalDy: number) => void;
  onCancel?: () => void;
  onReset?: () => void;
  label?: string;
};

const RESET_DRAG_SLOP_PX = 8;
const RESET_DOUBLE_MS = 400;

function edgeUsesX(edge: PdfDrawerResizeEdge): boolean {
  return edge === 'w' || edge === 'sw' || edge === 'e' || edge === 'se' || edge === 'nw';
}

function edgeUsesY(edge: PdfDrawerResizeEdge): boolean {
  return edge === 's' || edge === 'sw' || edge === 'se' || edge === 'n' || edge === 'nw';
}

export function PdfDrawerResizeHandle({
  edge,
  onStart,
  onPreview,
  onCommit,
  onCancel,
  onReset,
  label,
}: PdfDrawerResizeHandleProps) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const lastDx = useRef(0);
  const lastDy = useRef(0);
  const dragDist = useRef(0);
  const lastTapAt = useRef(0);
  const previewRaf = useRef(0);

  const cancelPreviewRaf = useCallback(() => {
    if (previewRaf.current !== 0) {
      cancelAnimationFrame(previewRaf.current);
      previewRaf.current = 0;
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      dragging.current = true;
      dragDist.current = 0;
      lastDx.current = 0;
      lastDy.current = 0;
      startX.current = event.clientX;
      startY.current = event.clientY;
      onStart?.();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    },
    [onStart],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) {
        return;
      }
      const dx = edgeUsesX(edge) ? event.clientX - startX.current : 0;
      const dy = edgeUsesY(edge) ? event.clientY - startY.current : 0;
      lastDx.current = dx;
      lastDy.current = dy;
      dragDist.current = Math.hypot(event.clientX - startX.current, event.clientY - startY.current);
      if (dragDist.current >= RESET_DRAG_SLOP_PX) {
        cancelPreviewRaf();
        previewRaf.current = requestAnimationFrame(() => {
          previewRaf.current = 0;
          onPreview(dx, dy);
        });
      }
      event.preventDefault();
    },
    [cancelPreviewRaf, edge, onPreview],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
      if (!dragging.current) {
        return;
      }
      const wasTap = dragDist.current < RESET_DRAG_SLOP_PX;
      const dx = lastDx.current;
      const dy = lastDy.current;
      dragging.current = false;
      cancelPreviewRaf();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (wasTap) {
        onCancel?.();
        if (!onReset) {
          return;
        }
        const now = Date.now();
        if (now - lastTapAt.current < RESET_DOUBLE_MS) {
          lastTapAt.current = 0;
          onReset();
          return;
        }
        lastTapAt.current = now;
        return;
      }
      if (commit) {
        onCommit(dx, dy);
        return;
      }
      onCancel?.();
    },
    [cancelPreviewRaf, onCancel, onCommit, onReset],
  );

  const className =
    edge === 'w'
      ? styles.pdfDrawerResizeW
      : edge === 's'
        ? styles.pdfDrawerResizeS
        : edge === 'sw'
          ? styles.pdfDrawerResizeSw
          : edge === 'e'
            ? styles.pdfDrawerResizeE
            : edge === 'se'
              ? styles.pdfDrawerResizeSe
              : edge === 'n'
                ? styles.stockDrawerResizeN
                : styles.stockDrawerResizeNw;
  const ariaLabel =
    label ??
    (edge === 'w' || edge === 'e'
      ? 'PDFの幅'
      : edge === 's' || edge === 'n'
        ? 'PDFの高さ'
        : 'PDFの幅と高さ');

  return (
    <div
      aria-label={ariaLabel}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
    />
  );
}

