'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { buildStripFrames, stripLayoutFromDoc, textChromeScreenMetrics } from '@/src/domain/stripGeometry';
import type { ClipId, TextId } from '@/src/domain/types';
import type { EditorDocument } from '@/src/storage/types';
import { CLIP_CHROME_ATTR, CLIP_COPY_ATTR, CLIP_DELETE_ATTR, CLIP_FRAME_ATTR, CLIP_ID_ATTR, CLIP_INSERT_ATTR } from './clip/constants';
import { PAGE_TEXT_ID_ATTR, PAGE_TEXT_WRAP_ATTR } from './gestures/pageTextDom';
import { clipAxisScale, clipInsertTarget, clipWorldBounds, rasterToDisplayScale, selectedClipIdsOf } from './clip/clipGeometry';
import { withoutStockedClips } from '@/src/domain/stockItems';
import { selectedTextIdsOf } from '@/src/domain/text';
import { effectiveClipPose, type ClipLiveTransform } from './clip/clipLiveTransform';
import type { MarqueePreview, LassoPreview } from '@/src/web/useEditorController';
import { PageInkCanvas } from '@/src/web/ink/PageInkCanvas';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from '@/src/web/editorStyles';

type PageInkOverlayProps = {
  doc: EditorDocument;
  engine: InkEngine;
  inkFrame: number;
  marqueePreview: MarqueePreview | null;
  lassoPreview: LassoPreview | null;
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
  onInsertClip: (clipId: ClipId) => void;
};

function DeleteMark({ icon, batch }: { icon: number; batch: boolean }) {
  if (!batch) {
    return (
      <svg viewBox="0 0 12 12" width={icon} height={icon} aria-hidden="true" focusable="false">
        <path
          d="M3 3l6 6M9 3l-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 12" width={icon} height={icon} aria-hidden="true" focusable="false">
      <path
        d="M1.5 2.5l4.5 7M6 2.5L1.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7.5 2.5l4.5 7M12 2.5L7.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClipBoxChrome({
  clipId,
  buttonPx,
  gapPx,
  style,
  canInsert,
  batch,
  onDeleteClip,
  onDuplicateClip,
  onInsertClip,
}: {
  clipId: ClipId;
  buttonPx: number;
  gapPx: number;
  style?: { left: number; top: number };
  canInsert: boolean;
  batch?: boolean;
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
  onInsertClip: (clipId: ClipId) => void;
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
        aria-label={batch ? '選択中のものを削除' : 'クリップを削除'}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDeleteClip(clipId);
        }}
      >
        <DeleteMark icon={icon} batch={Boolean(batch)} />
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
      {canInsert ? (
        <div
          role="button"
          className={styles.pageTextChromeButton}
          style={{ height: buttonPx, padding: `0 ${Math.max(6, buttonPx * 0.35)}px` }}
          {...{ [CLIP_INSERT_ATTR]: '' }}
          aria-label="クリップをコマに挿入"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onInsertClip(clipId);
          }}
        >
          <span style={{ fontSize: Math.max(9, buttonPx * 0.48), fontWeight: 600, lineHeight: 1 }}>挿入</span>
        </div>
      ) : null}
    </div>
  );
}

function ClipChromeOverlay({
  overlayRef,
  clipIds,
  textIds,
  zoom,
  panX,
  panY,
  layoutKey,
  onDeleteClip,
  onDuplicateClip,
  onInsertClip,
  canInsert,
}: {
  overlayRef: RefObject<HTMLDivElement | null>;
  clipIds: ClipId[];
  textIds: TextId[];
  zoom: number;
  panX: number;
  panY: number;
  layoutKey: unknown;
  canInsert: boolean;
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
  onInsertClip: (clipId: ClipId) => void;
}) {
  const [pose, setPose] = useState<{ left: number; top: number; button: number; gap: number } | null>(null);
  const primaryId = clipIds[clipIds.length - 1];
  const batch = clipIds.length + textIds.length > 1;

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || clipIds.length === 0) {
      setPose(null);
      return;
    }
    const root = overlay.parentElement ?? overlay;
    const frames = clipIds
      .map((id) => overlay.querySelector<HTMLElement>(`[${CLIP_FRAME_ATTR}][${CLIP_ID_ATTR}="${id}"]`))
      .filter((el): el is HTMLElement => el !== null);
    const wraps = textIds
      .map((id) =>
        root.querySelector<HTMLElement>(`[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}="${id}"]`),
      )
      .filter((el): el is HTMLElement => el !== null);
    const boxes = [...frames, ...wraps];
    if (boxes.length === 0) {
      setPose(null);
      return;
    }
    const metrics = textChromeScreenMetrics();
    const overlayRect = overlay.getBoundingClientRect();
    let left = Infinity;
    let top = Infinity;
    for (const box of boxes) {
      const boxRect = box.getBoundingClientRect();
      left = Math.min(left, boxRect.left);
      top = Math.min(top, boxRect.top);
    }
    setPose({
      left: left - overlayRect.left,
      top: top - overlayRect.top - metrics.stack,
      button: metrics.button,
      gap: metrics.gap,
    });
  }, [overlayRef, clipIds, textIds, zoom, panX, panY, layoutKey]);

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
        canInsert={canInsert}
        batch={batch}
        onDeleteClip={onDeleteClip}
        onDuplicateClip={onDuplicateClip}
        onInsertClip={onInsertClip}
      />
    </div>
  );
}

export function PageInkOverlay({
  doc,
  engine,
  inkFrame,
  marqueePreview,
  lassoPreview,
  clipLiveTransforms,
  onDeleteClip,
  onDuplicateClip,
  onInsertClip,
}: PageInkOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { frames } = buildStripFrames(doc.workspaceOrder, stripLayoutFromDoc(doc));
  const visibleClips = withoutStockedClips(doc.pasteboardClips, doc.stock, doc.trashClips);
  const selectedIds = selectedClipIdsOf(doc).filter((id) => visibleClips.some((clip) => clip.id === id));
  const selectedTextIds = selectedTextIdsOf(doc);
  const selectedIdSet = new Set(selectedIds);
  const showWorldMarquee =
    marqueePreview != null &&
    marqueePreview.rect.width > 0 &&
    marqueePreview.rect.height > 0;
  let lassoBox: { x: number; y: number; width: number; height: number } | null = null;
  if (lassoPreview && lassoPreview.points.length > 1) {
    let minX = lassoPreview.points[0]!.x;
    let minY = lassoPreview.points[0]!.y;
    let maxX = minX;
    let maxY = minY;
    for (let i = 1; i < lassoPreview.points.length; i += 1) {
      const point = lassoPreview.points[i]!;
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
    lassoBox = {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }
  const canInsert = selectedIds.some((id) => {
    const clip = doc.pasteboardClips.find((item) => item.id === id);
    if (!clip) {
      return false;
    }
    const pose = effectiveClipPose(clip, clipLiveTransforms[id]);
    return (
      clipInsertTarget(
        { ...clip, ...pose },
        engine.getRasterDimensions(clip.rasterId),
        doc.rasterWidth,
        doc.rasterHeight,
        frames,
      ) !== null
    );
  });

  return (
    <div ref={overlayRef} className={styles.pageInkOverlay}>
      <div
        className={styles.pageTextTransform}
        aria-hidden
        style={{
          transform: `translate(${doc.workspacePanX}px, ${doc.workspacePanY}px) scale(${doc.workspaceZoom})`,
          width: 'max-content',
          height: 'max-content',
          overflow: 'visible',
          ['--ms-screen-px' as string]: String(1 / Math.max(0.1, doc.workspaceZoom)),
        }}
      >
        {showWorldMarquee ? (
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

        {lassoBox && lassoPreview ? (
          <svg
            className={styles.lassoPreview}
            width={lassoBox.width}
            height={lassoBox.height}
            viewBox={`${lassoBox.x} ${lassoBox.y} ${lassoBox.width} ${lassoBox.height}`}
            style={{
              left: lassoBox.x,
              top: lassoBox.y,
              width: lassoBox.width,
              height: lassoBox.height,
            }}
            aria-hidden
          >
            <polygon points={lassoPreview.points.map((point) => `${point.x},${point.y}`).join(' ')} />
          </svg>
        ) : null}

        {visibleClips.map((clip) => {
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
              <PageInkCanvas
                engine={engine}
                rasterId={clip.rasterId}
                displayWidth={displayW}
                displayHeight={displayH}
                cssZoom={doc.workspaceZoom}
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
          textIds={selectedTextIds}
          zoom={doc.workspaceZoom}
          panX={doc.workspacePanX}
          panY={doc.workspacePanY}
          layoutKey={`${inkFrame}:${selectedIds.join(',')}:${selectedTextIds.join(',')}:${JSON.stringify(
            selectedIds.map((id) => clipLiveTransforms[id] ?? null),
          )}`}
          onDeleteClip={onDeleteClip}
          onDuplicateClip={onDuplicateClip}
          onInsertClip={onInsertClip}
          canInsert={canInsert}
        />
      ) : null}
    </div>
  );
}

export function rasterIdForClip(doc: EditorDocument, clipId: ClipId): string | null {
  const clip = doc.pasteboardClips.find((item) => item.id === clipId);
  return clip?.rasterId ?? null;
}
