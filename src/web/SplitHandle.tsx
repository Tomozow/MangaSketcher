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

type PdfDrawerResizeEdge = 'w' | 's' | 'sw' | 'e' | 'se';

type PdfDrawerResizeHandleProps = {
  edge: PdfDrawerResizeEdge;
  onDrag: (deltaX: number, deltaY: number) => void;
};

export function PdfDrawerResizeHandle({ edge, onDrag }: PdfDrawerResizeHandleProps) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    dragging.current = true;
    lastX.current = event.clientX;
    lastY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) {
        return;
      }
      const dx = event.clientX - lastX.current;
      const dy = event.clientY - lastY.current;
      lastX.current = event.clientX;
      lastY.current = event.clientY;
      const useX = edge === 'w' || edge === 'sw' || edge === 'e' || edge === 'se';
      const useY = edge === 's' || edge === 'sw' || edge === 'se';
      if ((useX && dx !== 0) || (useY && dy !== 0)) {
        onDrag(useX ? dx : 0, useY ? dy : 0);
      }
      event.preventDefault();
    },
    [edge, onDrag],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const className =
    edge === 'w'
      ? styles.pdfDrawerResizeW
      : edge === 's'
        ? styles.pdfDrawerResizeS
        : edge === 'sw'
          ? styles.pdfDrawerResizeSw
          : edge === 'e'
            ? styles.pdfDrawerResizeE
            : styles.pdfDrawerResizeSe;
  const label =
    edge === 'w' || edge === 'e' ? 'PDFの幅' : edge === 's' ? 'PDFの高さ' : 'PDFの幅と高さ';

  return (
    <div
      aria-label={label}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}

