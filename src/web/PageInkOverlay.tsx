'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { buildStripFrames, PAGE_DISPLAY_W, stripLayoutFromDoc, textChromeScreenMetrics } from '@/src/domain/stripGeometry';
import type { ClipId } from '@/src/domain/types';
import type { EditorDocument } from '@/src/storage/types';
import { clipWorldBounds, rasterToDisplayScale, selectedClipIdsOf } from './clip/clipGeometry';
import {
  CLIP_CHROME_ATTR,
  CLIP_COPY_ATTR,
  CLIP_DELETE_ATTR,
  CLIP_FRAME_ATTR,
  CLIP_ID_ATTR,
} from './clip/constants';
import { effectiveClipPose, type ClipLiveTransform } from './clip/clipLiveTransform';
import type { MarqueePreview } from '@/src/web/useEditorController';
import { PageInkCanvas } from '@/src/web/ink/PageInkCanvas';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from '@/src/web/editorStyles';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

const lastClipLayoutKey = new Map<string, string>();

type PageInkOverlayProps = {
  doc: EditorDocument;
  engine: InkEngine;
  inkFrame: number;
  marqueePreview: MarqueePreview | null;
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
};

function ClipBoxChrome({
  clipId,
  buttonPx,
  gapPx,
  style,
  onDeleteClip,
  onDuplicateClip,
}: {
  clipId: ClipId;
  buttonPx: number;
  gapPx: number;
  style?: { left: number; top: number };
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
}) {
  const size = { width: buttonPx, height: buttonPx };
  const icon = Math.max(6, buttonPx * 0.6);
  return (
    <div
      className={styles.pageTextChrome}
      style={{ ...style, gap: gapPx, height: buttonPx }}
      {...{ [CLIP_CHROME_ATTR]: '' }}
    >
      <div
        role="button"
        className={styles.pageTextChromeButton}
        style={size}
        {...{ [CLIP_DELETE_ATTR]: '' }}
        aria-label="クリップを削除"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDeleteClip(clipId);
        }}
      >
        <svg viewBox="0 0 12 12" width={icon} height={icon} aria-hidden="true" focusable="false">
          <path
            d="M2.5 2.5h7v7h-7z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path d="M4 4h4M4 8h4" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </div>
      <div
        role="button"
        className={styles.pageTextChromeButton}
        style={size}
        {...{ [CLIP_COPY_ATTR]: '' }}
        aria-label="クリップを複製"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDuplicateClip(clipId);
        }}
      >
        <svg viewBox="0 0 12 12" width={icon} height={icon} aria-hidden="true" focusable="false">
          <rect x="3.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <rect x="1.5" y="3.5" width="7" height="7" fill="var(--ms-background)" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </div>
    </div>
  );
}

function ClipChromeOverlay({
  overlayRef,
  clipIds,
  zoom,
  panX,
  panY,
  layoutKey,
  onDeleteClip,
  onDuplicateClip,
}: {
  overlayRef: RefObject<HTMLDivElement | null>;
  clipIds: ClipId[];
  zoom: number;
  panX: number;
  panY: number;
  layoutKey: unknown;
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
}) {
  const [pose, setPose] = useState<{ left: number; top: number; button: number; gap: number } | null>(null);
  const primaryId = clipIds[clipIds.length - 1];

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || clipIds.length === 0) {
      setPose(null);
      return;
    }
    const frames = clipIds
      .map((id) => overlay.querySelector<HTMLElement>(`[${CLIP_FRAME_ATTR}][${CLIP_ID_ATTR}="${id}"]`))
      .filter((el): el is HTMLElement => el !== null);
    if (frames.length === 0) {
      setPose(null);
      return;
    }
    const metrics = textChromeScreenMetrics(PAGE_DISPLAY_W * Math.max(0.1, zoom));
    const overlayRect = overlay.getBoundingClientRect();
    let left = Infinity;
    let top = Infinity;
    for (const frame of frames) {
      const frameRect = frame.getBoundingClientRect();
      left = Math.min(left, frameRect.left);
      top = Math.min(top, frameRect.top);
    }
    setPose({
      left: left - overlayRect.left,
      top: top - overlayRect.top - metrics.stack,
      button: metrics.button,
      gap: metrics.gap,
    });
  }, [overlayRef, zoom, panX, panY, layoutKey]);

  if (!pose || !primaryId) {
    return null;
  }

  return (
    <div className={styles.pageTextChromeLayer}>
      <ClipBoxChrome
        clipId={primaryId}
        buttonPx={pose.button}
        gapPx={pose.gap}
        style={{ left: pose.left, top: pose.top }}
        onDeleteClip={onDeleteClip}
        onDuplicateClip={onDuplicateClip}
      />
    </div>
  );
}

export function PageInkOverlay({
  doc,
  engine,
  inkFrame,
  marqueePreview,
  clipLiveTransforms,
  onDeleteClip,
  onDuplicateClip,
}: PageInkOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { frames } = buildStripFrames(doc.workspaceOrder, stripLayoutFromDoc(doc));
  const selectedIds = selectedClipIdsOf(doc);
  const selectedIdSet = new Set(selectedIds);
  const showPasteboardMarquee =
    marqueePreview?.pageId === null &&
    marqueePreview.rect.width > 0 &&
    marqueePreview.rect.height > 0;

  return (
    <div ref={overlayRef} className={styles.pageInkOverlay}>
      <div
        className={styles.pageTextTransform}
        aria-hidden
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
          const showMarquee =
            marqueePreview?.pageId === pageId &&
            marqueePreview.rect.width > 0 &&
            marqueePreview.rect.height > 0;
          if (!showMarquee) {
            return null;
          }

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
              <div
                className={styles.marqueePreview}
                style={{
                  left: `${(marqueePreview.rect.x / doc.rasterWidth) * 100}%`,
                  top: `${(marqueePreview.rect.y / doc.rasterHeight) * 100}%`,
                  width: `${(marqueePreview.rect.width / doc.rasterWidth) * 100}%`,
                  height: `${(marqueePreview.rect.height / doc.rasterHeight) * 100}%`,
                }}
              />
            </div>
          );
        })}

        {showPasteboardMarquee ? (
          <div
            className={styles.marqueePreview}
            style={{
              left: marqueePreview.rect.x,
              top: marqueePreview.rect.y,
              width: marqueePreview.rect.width,
              height: marqueePreview.rect.height,
            }}
          />
        ) : null}

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
          // #region agent log
          const layoutKey = `${size.width}x${size.height}:${Math.round(displayW)}x${Math.round(displayH)}`;
          if (lastClipLayoutKey.get(clip.id) !== layoutKey) {
            lastClipLayoutKey.set(clip.id, layoutKey);
            ipadDebugLog({
              sessionId: '5a1fb6',
              ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
              hypothesisId: 'H5',
              location: 'PageInkOverlay.tsx:clip',
              message: 'clip overlay layout',
              data: {
                runId: 'post-fix',
                clipId: clip.id,
                rasterId: clip.rasterId,
                size,
                displayW,
                displayH,
                panX: doc.workspacePanX,
                panY: doc.workspacePanY,
              },
              timestamp: Date.now(),
            });
          }
          // #endregion

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
              <PageInkCanvas
                engine={engine}
                rasterId={clip.rasterId}
                displayWidth={displayW}
                inkFrame={inkFrame}
              />
              {selectedIdSet.has(clip.id) ? (
                <>
                  <div className={styles.clipHandleRotate} aria-hidden />
                  <div className={styles.clipHandleCorner} aria-hidden />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {selectedIds.length > 0 ? (
        <ClipChromeOverlay
          overlayRef={overlayRef}
          clipIds={selectedIds}
          zoom={doc.workspaceZoom}
          panX={doc.workspacePanX}
          panY={doc.workspacePanY}
          layoutKey={`${inkFrame}:${selectedIds.join(',')}:${JSON.stringify(
            selectedIds.map((id) => clipLiveTransforms[id] ?? null),
          )}`}
          onDeleteClip={onDeleteClip}
          onDuplicateClip={onDuplicateClip}
        />
      ) : null}
    </div>
  );
}

export function rasterIdForClip(doc: EditorDocument, clipId: ClipId): string | null {
  const clip = doc.pasteboardClips.find((item) => item.id === clipId);
  return clip?.rasterId ?? null;
}
