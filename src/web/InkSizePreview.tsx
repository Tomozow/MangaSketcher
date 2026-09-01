'use client';

import { brushRadius } from '@/src/domain/pointers';
import { PAGE_DISPLAY_W } from '@/src/domain/stripGeometry';
import { styles } from './editorStyles';

export const INK_SIZE_PREVIEW_HIDE_MS = 900;

/** Screen CSS diameter of a full-pressure stamp, matching page ink (raster → 216px display × zoom). */
export function inkSizePreviewDiameterPx(size: number, zoom: number, rasterWidth: number): number {
  const rasterDiameter = brushRadius(size, 1, 'pencil', false) * 2;
  const pageScale = PAGE_DISPLAY_W / Math.max(1, rasterWidth);
  return rasterDiameter * pageScale * Math.max(0.01, zoom);
}

export type InkSizePreviewKind = 'pen' | 'eraser';

type InkSizePreviewProps = {
  kind: InkSizePreviewKind;
  diameter: number;
  color: string;
  opacity: number;
  size: number;
};

export function InkSizePreview({ kind, diameter, color, opacity, size }: InkSizePreviewProps) {
  const px = Math.round(diameter * 10) / 10;
  return (
    <div className={styles.inkSizePreview} data-kind={kind} aria-hidden="true">
      <div className={styles.inkSizePreviewStack}>
        <span
          className={styles.inkSizePreviewDot}
          style={{
            width: px,
            height: px,
            background: kind === 'pen' ? color : 'rgba(255, 255, 255, 0.18)',
            opacity: kind === 'pen' ? opacity : 1,
          }}
        />
        <span className={styles.inkSizePreviewLabel}>{Math.round(size)}</span>
      </div>
    </div>
  );
}
