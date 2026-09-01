'use client';

import { brushRadius } from '@/src/domain/pointers';
import { styles } from './editorStyles';

export const INK_SIZE_PREVIEW_HIDE_MS = 900;

export function inkSizePreviewDiameterPx(size: number, zoom: number): number {
  return Math.max(1, brushRadius(size, 1, 'pencil', false) * 2 * Math.max(0.01, zoom));
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
