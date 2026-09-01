'use client';

import { CLIP_FRAME_ATTR, CLIP_ID_ATTR } from './constants';
import { clipAxisScale, clipWorldBounds, rasterToDisplayScale } from './clipGeometry';
import { effectiveClipPose, type ClipLiveTransform } from './clipLiveTransform';
import type { ClipId, ClipMeta } from '@/src/domain/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { PageInkCanvas } from '@/src/web/ink/PageInkCanvas';
import { styles } from '@/src/web/editorStyles';

type PasteboardClipsLayerProps = {
  clips: ClipMeta[];
  selectedClipIds: ClipId[];
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
  engine: InkEngine;
  rasterWidth: number;
  rasterHeight: number;
  zoom: number;
  inkFrame: number;
  getClipRasterSize: (clipId: ClipId) => { width: number; height: number };
  displayInkRasterIds: ReadonlySet<string>;
};

export function PasteboardClipsLayer({
  clips,
  selectedClipIds,
  clipLiveTransforms,
  engine,
  rasterWidth,
  rasterHeight,
  zoom,
  inkFrame,
  getClipRasterSize,
  displayInkRasterIds,
}: PasteboardClipsLayerProps) {
  const selectedIdSet = new Set(selectedClipIds);
  const { sx, sy } = rasterToDisplayScale(rasterWidth, rasterHeight);

  return (
    <>
      {clips.map((clip) => {
        const pose = effectiveClipPose(clip, clipLiveTransforms[clip.id]);
        const clipForLayout = { ...clip, ...pose };
        const size = getClipRasterSize(clip.id);
        const bounds = clipWorldBounds(clipForLayout, size, rasterWidth, rasterHeight);
        const { scaleX, scaleY } = clipAxisScale(pose);
        const displayW = size.width * sx * scaleX;
        const displayH = size.height * sy * scaleY;

        return (
          <div
            key={clip.id}
            className={`${styles.clipFrame} ${selectedIdSet.has(clip.id) ? styles.clipFrameSelected : ''}`}
            {...{ [CLIP_FRAME_ATTR]: '', [CLIP_ID_ATTR]: clip.id }}
            style={{
              position: 'absolute',
              left: bounds.cx,
              top: bounds.cy,
              width: displayW,
              height: displayH,
              transform: `translate(-50%, -50%) rotate(${pose.rotation}rad)`,
            }}
          >
            {displayInkRasterIds.has(clip.rasterId) ? (
              <PageInkCanvas
                engine={engine}
                rasterId={clip.rasterId}
                displayWidth={displayW}
                displayHeight={displayH}
                cssZoom={zoom}
                inkFrame={inkFrame}
              />
            ) : null}
            {selectedIdSet.has(clip.id) ? (
              <>
                <div className={styles.clipHandleRotate} aria-hidden />
                <div className={styles.clipHandleCorner} aria-hidden />
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
