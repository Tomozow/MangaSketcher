'use client';

import { buildStripFrames, stripLayoutFromDoc } from '@/src/domain/stripGeometry';
import type { ClipId } from '@/src/domain/types';
import type { EditorDocument } from '@/src/storage/types';
import { clipWorldBounds, rasterToDisplayScale } from './clip/clipGeometry';
import { effectiveClipPose, type ClipLiveTransform } from './clip/clipLiveTransform';
import type { MarqueePreview } from '@/src/web/useEditorController';
import { PageInkCanvas } from '@/src/web/ink/PageInkCanvas';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from '@/src/web/editorStyles';

type PageInkOverlayProps = {
  doc: EditorDocument;
  engine: InkEngine;
  inkFrame: number;
  marqueePreview: MarqueePreview | null;
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
};

export function PageInkOverlay({
  doc,
  engine,
  inkFrame,
  marqueePreview,
  clipLiveTransforms,
}: PageInkOverlayProps) {
  const { frames } = buildStripFrames(doc.workspaceOrder, stripLayoutFromDoc(doc));

  return (
    <div className={styles.pageInkOverlay} aria-hidden>
      <div
        className={styles.pageTextTransform}
        style={{
          transform: `translate(${doc.workspacePanX}px, ${doc.workspacePanY}px) scale(${doc.workspaceZoom})`,
          width: 'max-content',
          height: 'max-content',
        }}
      >
        {frames.map((frame) => {
          if (frame.slot.kind !== 'page') {
            return null;
          }
          const pageId = frame.slot.pageId;
          const rasterId = doc.pages[pageId]?.rasterId;
          if (!rasterId) {
            return null;
          }

          const showMarquee =
            marqueePreview?.pageId === pageId &&
            marqueePreview.rect.width > 0 &&
            marqueePreview.rect.height > 0;

          return (
            <div
              key={frame.key}
              style={{
                position: 'absolute',
                left: frame.x,
                top: frame.y,
                width: frame.width,
                height: frame.height,
              }}
            >
              <PageInkCanvas
                engine={engine}
                rasterId={rasterId}
                displayWidth={frame.width}
                inkFrame={inkFrame}
                className={styles.pageInkCanvas}
              />
              {showMarquee ? (
                <div
                  className={styles.marqueePreview}
                  style={{
                    left: `${(marqueePreview.rect.x / doc.rasterWidth) * 100}%`,
                    top: `${(marqueePreview.rect.y / doc.rasterHeight) * 100}%`,
                    width: `${(marqueePreview.rect.width / doc.rasterWidth) * 100}%`,
                    height: `${(marqueePreview.rect.height / doc.rasterHeight) * 100}%`,
                  }}
                />
              ) : null}
            </div>
          );
        })}

        {doc.pasteboardClips.map((clip) => {
          const pose = effectiveClipPose(clip, clipLiveTransforms[clip.id]);
          const clipForLayout = { ...clip, ...pose };
          const size = engine.getRasterDimensions(clip.rasterId);
          const bounds = clipWorldBounds(
            clipForLayout,
            size,
            doc.rasterWidth,
            doc.rasterHeight,
          );
          const { sx, sy } = rasterToDisplayScale(doc.rasterWidth, doc.rasterHeight);
          const displayW = size.width * sx * pose.scale;
          const displayH = size.height * sy * pose.scale;

          return (
            <div
              key={clip.id}
              className={styles.clipFrame}
              style={{
                position: 'absolute',
                left: bounds.cx,
                top: bounds.cy,
                width: displayW,
                height: displayH,
                transform: `translate(-50%, -50%) rotate(${pose.rotation}rad)`,
              }}
            >
              <PageInkCanvas
                engine={engine}
                rasterId={clip.rasterId}
                displayWidth={displayW}
                inkFrame={inkFrame}
              />
              {doc.selectedClipId === clip.id ? (
                <>
                  <div className={styles.clipHandleRotate} aria-hidden />
                  <div className={styles.clipHandleCorner} aria-hidden />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function rasterIdForClip(doc: EditorDocument, clipId: ClipId): string | null {
  const clip = doc.pasteboardClips.find((item) => item.id === clipId);
  return clip?.rasterId ?? null;
}
