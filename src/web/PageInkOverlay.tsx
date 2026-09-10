'use client';

import type { ClipId, TextId } from '@/src/domain/types';
import type { EditorDocument } from '@/src/storage/types';
import { CLIP_CHROME_ATTR, CLIP_COPY_ATTR, CLIP_DELETE_ATTR, CLIP_INSERT_ATTR, CLIP_MERGE_ATTR } from './clip/constants';
import {
  chromeScreenPoseFromWorldAabbs,
  clipInsertTarget,
  clipWorldAxisAlignedBounds,
  clipWorldBounds,
  pageLocalRectToWorldRect,
  selectedClipIdsOf,
  worldAabbFromRect,
  type WorldAabb,
} from './clip/clipGeometry';
import { withoutStockedClips } from '@/src/domain/stockItems';
import { findText, selectedTextIdsOf } from '@/src/domain/text';
import { buildStripFrames, stripLayoutFromDoc, type StripFrame } from '@/src/domain/stripGeometry';
import { effectiveClipPose, type ClipLiveTransform } from './clip/clipLiveTransform';
import { effectiveTextBox, type TextLiveTransform } from './text/textLiveTransform';
import type { MarqueePreview, LassoPreview } from '@/src/web/useEditorController';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from '@/src/web/editorStyles';

type PageInkOverlayProps = {
  doc: EditorDocument;
  engine: InkEngine;
  marqueePreview: MarqueePreview | null;
  lassoPreview: LassoPreview | null;
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
  textLiveTransforms?: Readonly<Record<string, TextLiveTransform>>;
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
  onInsertClip: (clipId: ClipId) => void;
  onMergeClips: (clipId: ClipId) => void;
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
  canMerge,
  batch,
  onDeleteClip,
  onDuplicateClip,
  onInsertClip,
  onMergeClips,
}: {
  clipId: ClipId;
  buttonPx: number;
  gapPx: number;
  style?: { left: number; top: number };
  canInsert: boolean;
  canMerge?: boolean;
  batch?: boolean;
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
  onInsertClip: (clipId: ClipId) => void;
  onMergeClips: (clipId: ClipId) => void;
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
        aria-label={batch ? '選択中のものを複製' : 'クリップを複製'}
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
      {canMerge ? (
        <div
          role="button"
          className={styles.pageTextChromeButton}
          style={{ height: buttonPx, padding: `0 ${Math.max(6, buttonPx * 0.35)}px` }}
          {...{ [CLIP_MERGE_ATTR]: '' }}
          aria-label="クリップを結合"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onMergeClips(clipId);
          }}
        >
          <span style={{ fontSize: Math.max(9, buttonPx * 0.48), fontWeight: 600, lineHeight: 1 }}>結合</span>
        </div>
      ) : null}
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

function selectedTextWorldAabbs(
  doc: EditorDocument,
  frames: StripFrame[],
  textIds: TextId[],
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>,
): WorldAabb[] {
  const frameByPage = new Map<string, StripFrame>();
  for (const frame of frames) {
    if (frame.slot.kind === 'page') {
      frameByPage.set(frame.slot.pageId, frame);
    }
  }
  const aabbs: WorldAabb[] = [];
  for (const textId of textIds) {
    const found = findText(doc, textId);
    if (!found) {
      continue;
    }
    const live = textLiveTransforms[textId];
    const onPasteboard =
      live?.where === 'pasteboard' || (found.where === 'pasteboard' && live?.where !== 'page');
    if (onPasteboard) {
      aabbs.push(worldAabbFromRect(effectiveTextBox(found.node.box, live)));
      continue;
    }
    const pageId = live?.where === 'page' && live.pageId ? live.pageId : found.pageId;
    const frame = pageId ? frameByPage.get(pageId) : undefined;
    if (!frame) {
      continue;
    }
    const local = effectiveTextBox(found.node.box, live?.where === 'page' ? live : null);
    aabbs.push(
      worldAabbFromRect(
        pageLocalRectToWorldRect(
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          local,
          doc.rasterWidth,
          doc.rasterHeight,
        ),
      ),
    );
  }
  return aabbs;
}

function ClipChromeOverlay({
  pose,
  clipIds,
  textIds,
  onDeleteClip,
  onDuplicateClip,
  onInsertClip,
  onMergeClips,
  canInsert,
}: {
  pose: { left: number; top: number; button: number; gap: number };
  clipIds: ClipId[];
  textIds: TextId[];
  canInsert: boolean;
  onDeleteClip: (clipId: ClipId) => void;
  onDuplicateClip: (clipId: ClipId) => void;
  onInsertClip: (clipId: ClipId) => void;
  onMergeClips: (clipId: ClipId) => void;
}) {
  const primaryId = clipIds[clipIds.length - 1];
  if (!primaryId) {
    return null;
  }
  const batch = clipIds.length + textIds.length > 1;

  return (
    <div className={styles.pageTextChromeLayer}>
      <ClipBoxChrome
        clipId={primaryId}
        buttonPx={pose.button}
        gapPx={pose.gap}
        style={{ left: pose.left, top: pose.top }}
        canInsert={canInsert}
        canMerge={clipIds.length >= 2}
        batch={batch}
        onDeleteClip={onDeleteClip}
        onDuplicateClip={onDuplicateClip}
        onInsertClip={onInsertClip}
        onMergeClips={onMergeClips}
      />
    </div>
  );
}

export function PageInkOverlay({
  doc,
  engine,
  marqueePreview,
  lassoPreview,
  clipLiveTransforms,
  textLiveTransforms = {},
  onDeleteClip,
  onDuplicateClip,
  onInsertClip,
  onMergeClips,
}: PageInkOverlayProps) {
  const { frames } = buildStripFrames(doc.workspaceOrder, stripLayoutFromDoc(doc));
  const visibleClips = withoutStockedClips(doc.pasteboardClips, doc.stock, doc.trashClips);
  const selectedIds = selectedClipIdsOf(doc).filter((id) => visibleClips.some((clip) => clip.id === id));
  const selectedTextIds = selectedTextIdsOf(doc);
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

  const chromeAabbs: WorldAabb[] = [];
  for (const clipId of selectedIds) {
    const clip = visibleClips.find((item) => item.id === clipId);
    if (!clip) {
      continue;
    }
    const pose = effectiveClipPose(clip, clipLiveTransforms[clip.id]);
    chromeAabbs.push(
      clipWorldAxisAlignedBounds(
        clipWorldBounds(
          { ...clip, ...pose },
          engine.getRasterDimensions(clip.rasterId),
          doc.rasterWidth,
          doc.rasterHeight,
        ),
      ),
    );
  }
  chromeAabbs.push(...selectedTextWorldAabbs(doc, frames, selectedTextIds, textLiveTransforms));
  const chromePose =
    selectedIds.length > 0
      ? chromeScreenPoseFromWorldAabbs(chromeAabbs, doc.workspaceZoom, doc.workspacePanX, doc.workspacePanY)
      : null;

  return (
    <div className={styles.pageInkOverlay}>
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
      </div>
      {chromePose ? (
        <ClipChromeOverlay
          pose={chromePose}
          clipIds={selectedIds}
          textIds={selectedTextIds}
          onDeleteClip={onDeleteClip}
          onDuplicateClip={onDuplicateClip}
          onInsertClip={onInsertClip}
          onMergeClips={onMergeClips}
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
