'use client';

import { useEffect, useRef } from 'react';
import type { PageId, PageText } from '@/src/domain/types';
import { THUMB_HEIGHT, THUMB_WIDTH } from '@/src/web/ink/InkEngine';
import { drawPageTextsOnThumb } from '@/src/web/ink/drawPageTextsOnThumb';
import { styles } from './editorStyles';

export const PAGE_TEMPLATE_URL = '/page_template.jpg';

type PageThumbLayersProps = {
  pageId: PageId;
  /** §9.7 template+ink thumb when InkEngine is wired; template-only fallback otherwise. */
  thumb?: ImageBitmap;
  texts?: readonly PageText[];
  rasterWidth?: number;
  rasterHeight?: number;
};

export function PageThumbLayers({
  pageId,
  thumb,
  texts,
  rasterWidth,
  rasterHeight,
}: PageThumbLayersProps) {
  const inkRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = inkRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    if (thumb) {
      ctx.drawImage(thumb, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    }
    if (texts && texts.length > 0 && rasterWidth && rasterHeight) {
      drawPageTextsOnThumb(ctx, texts, rasterWidth, rasterHeight, THUMB_WIDTH, THUMB_HEIGHT);
    }
  }, [thumb, pageId, texts, rasterWidth, rasterHeight]);

  return (
    <>
      <div
        className={styles.pageDragThumbTemplate}
        style={{ backgroundImage: `url(${PAGE_TEMPLATE_URL})` }}
      />
      <canvas
        ref={inkRef}
        className={styles.pageDragThumbInk}
        width={THUMB_WIDTH}
        height={THUMB_HEIGHT}
        aria-hidden
      />
    </>
  );
}
