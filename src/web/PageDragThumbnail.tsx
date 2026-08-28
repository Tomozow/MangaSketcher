'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PageId } from '@/src/domain/types';
import { THUMB_HEIGHT, THUMB_WIDTH } from '@/src/web/ink/InkEngine';
import styles from './editor.module.css';

const TEMPLATE_URL = '/page_template.jpg';

type PageDragThumbnailProps = {
  pageId: PageId;
  clientX: number;
  clientY: number;
  /** §9.7 template+ink thumb when InkEngine is wired; template-only fallback otherwise. */
  thumb?: ImageBitmap;
};

export function PageDragThumbnail({ pageId, clientX, clientY, thumb }: PageDragThumbnailProps) {
  const inkRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = inkRef.current;
    if (!canvas || !thumb) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    ctx.drawImage(thumb, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  }, [thumb, pageId]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className={styles.pageDragThumb}
      style={{
        left: clientX,
        top: clientY,
        width: THUMB_WIDTH,
        height: THUMB_HEIGHT,
      }}
      aria-hidden
    >
      <div className={styles.pageDragThumbTemplate} style={{ backgroundImage: `url(${TEMPLATE_URL})` }} />
      <canvas
        ref={inkRef}
        className={styles.pageDragThumbInk}
        width={THUMB_WIDTH}
        height={THUMB_HEIGHT}
      />
    </div>,
    document.body,
  );
}
