'use client';

import { createPortal } from 'react-dom';
import type { PageId, PageText } from '@/src/domain/types';
import { THUMB_HEIGHT, THUMB_WIDTH } from '@/src/web/ink/InkEngine';
import { PageThumbLayers } from '@/src/web/PageThumbLayers';
import { styles } from './editorStyles';

type PageDragThumbnailProps = {
  pageId: PageId;
  clientX: number;
  clientY: number;
  /** §9.7 template+ink thumb when InkEngine is wired; template-only fallback otherwise. */
  thumb?: ImageBitmap;
  texts?: readonly PageText[];
  rasterWidth?: number;
  rasterHeight?: number;
};

export function PageDragThumbnail({
  pageId,
  clientX,
  clientY,
  thumb,
  texts,
  rasterWidth,
  rasterHeight,
}: PageDragThumbnailProps) {
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
      <PageThumbLayers
        pageId={pageId}
        thumb={thumb}
        texts={texts}
        rasterWidth={rasterWidth}
        rasterHeight={rasterHeight}
      />
    </div>,
    document.body,
  );
}
