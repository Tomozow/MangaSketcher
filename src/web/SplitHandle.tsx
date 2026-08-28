'use client';

import { useCallback, useRef } from 'react';
import styles from './editor.module.css';

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
