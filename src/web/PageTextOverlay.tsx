'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  type PageId,
  type PageText,
  type PasteboardText,
  type Rect,
  type TextId,
} from '@/src/domain/types';
import {
  PAGE_DISPLAY_H,
  PAGE_DISPLAY_W,
  textChromeScreenMetrics,
  type StripFrame,
} from '@/src/domain/stripGeometry';
import type { EditorDocument } from '@/src/storage/types';
import { fitTextBoxToContent } from '@/src/domain/textWrap';
import {
  effectiveTextBox,
  sanitizeTextBox,
  textRenderPageId,
  type TextLiveTransform,
} from '@/src/web/text/textLiveTransform';
import {
  PAGE_TEXT_CHROME_ATTR,
  PAGE_TEXT_CONFIRM_ATTR,
  PAGE_TEXT_COPY_ATTR,
  PAGE_TEXT_DELETE_ATTR,
  PAGE_TEXT_ID_ATTR,
  PAGE_TEXT_PAGE_ATTR,
  PAGE_TEXT_WRAP_ATTR,
} from '@/src/web/gestures/pageTextDom';
import { styles } from '@/src/web/editorStyles';
import { PAGE_INK_FRAME_ATTR } from '@/src/web/gestures/pageInkDom';
import { pageBoxToWorld } from '@/src/web/gestures/elementInteraction';
import { useLiveTextContent, type LiveTextContent } from '@/src/web/liveTextContentStore';

type PageTextOverlayProps = {
  doc: EditorDocument;
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
  onDeleteText: (textId: TextId) => void;
};

function displayTextFontSize(fontSize: number, scaleX: number): number {
  return fontSize * scaleX;
}

export function textsForFrame(
  framePageId: PageId,
  pages: EditorDocument['pages'],
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>,
): PageText[] {
  const result: PageText[] = [];
  for (const [homePageId, page] of Object.entries(pages)) {
    for (const text of page.texts) {
      const live = textLiveTransforms[text.id];
      if (live?.where !== 'pasteboard' && textRenderPageId(homePageId, live) === framePageId) {
        result.push(text);
      }
    }
  }
  return result;
}

function rasterSize(value: number, fallback: number): number {
  return value > 0 ? value : fallback;
}

function rasterPct(value: number, raster: number): string {
  return `${(value / raster) * 100}%`;
}

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

function TextBoxChrome({
  textId,
  buttonPx,
  gapPx,
  style,
  batch,
  showConfirm,
  onDeleteText,
  onDuplicateText,
}: {
  textId: TextId;
  buttonPx: number;
  gapPx: number;
  style?: { left: number; top: number };
  batch?: boolean;
  showConfirm?: boolean;
  onDeleteText: (textId: TextId) => void;
  onDuplicateText: (textId: TextId) => void;
}) {
  const size = { width: buttonPx, height: buttonPx };
  const icon = Math.max(6, buttonPx * 0.6);
  return (
    <div
      className={styles.pageTextChrome}
      style={{ ...style, gap: gapPx, height: buttonPx }}
      {...{ [PAGE_TEXT_CHROME_ATTR]: '' }}
    >
      <div
        role="button"
        className={styles.pageTextChromeButton}
        style={size}
        {...{ [PAGE_TEXT_DELETE_ATTR]: '' }}
        aria-label={batch ? '選択中のテキストを削除' : 'テキストを削除'}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDeleteText(textId);
        }}
      >
        <DeleteMark icon={icon} batch={Boolean(batch)} />
      </div>
      <div
        role="button"
        className={styles.pageTextChromeButton}
        style={size}
        {...{ [PAGE_TEXT_COPY_ATTR]: '' }}
        aria-label="テキストを複製"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDuplicateText(textId);
        }}
      >
        <svg viewBox="0 0 12 12" width={icon} height={icon} aria-hidden="true" focusable="false">
          <rect x="3.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <rect x="1.5" y="3.5" width="7" height="7" fill="var(--ms-background)" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </div>
      {showConfirm ? (
        <div
          role="button"
          className={styles.pageTextChromeButton}
          style={size}
          {...{ [PAGE_TEXT_CONFIRM_ATTR]: '' }}
          aria-label="テキストを確定"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
        >
          <svg viewBox="0 0 12 12" width={icon} height={icon} aria-hidden="true" focusable="false">
            <path
              d="M2.4 6.2l2.6 2.6 4.6-5.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : null}
    </div>
  );
}

export type { LiveTextContent } from '@/src/web/liveTextContentStore';

type PageTextsOnFrameProps = {
  pageId: PageId;
  texts: PageText[];
  rasterWidth: number;
  rasterHeight: number;
  selectedTextId: TextId | null;
  selectedTextIds?: TextId[];
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
  liveTextContent?: LiveTextContent | null;
};

/** Page-local text boxes. Must render inside the page frame, not a sibling overlay. */
export function PageTextsOnFrame({
  pageId,
  texts,
  rasterWidth,
  rasterHeight,
  selectedTextId,
  selectedTextIds,
  textLiveTransforms,
  liveTextContent: liveTextContentProp,
}: PageTextsOnFrameProps) {
  const liveFromStore = useLiveTextContent();
  const liveTextContent = liveTextContentProp !== undefined ? liveTextContentProp : liveFromStore;
  const rw = rasterSize(rasterWidth, DEFAULT_RASTER_WIDTH);
  const rh = rasterSize(rasterHeight, DEFAULT_RASTER_HEIGHT);
  const scaleX = PAGE_DISPLAY_W / rw;
  const selectedIdSet = new Set(selectedTextIds ?? (selectedTextId ? [selectedTextId] : []));

  return (
    <>
      {texts.map((text) => {
        const selected = selectedIdSet.has(text.id);
        const box0 = effectiveTextBox(sanitizeTextBox(text.box), textLiveTransforms[text.id]);
        const fontSize = Number.isFinite(text.fontSize) ? text.fontSize : 12;
        const resizeScale = box0.width / Math.max(1, sanitizeTextBox(text.box).width);
        const content = liveTextContent?.id === text.id ? liveTextContent.content : text.content;
        const box =
          liveTextContent?.id === text.id
            ? fitTextBoxToContent(box0, content, fontSize * resizeScale)
            : box0;
        const cssFontSize = displayTextFontSize(fontSize * resizeScale, scaleX);
        return (
          <div
            key={text.id}
            {...{
              [PAGE_TEXT_WRAP_ATTR]: '',
              [PAGE_TEXT_ID_ATTR]: text.id,
              [PAGE_TEXT_PAGE_ATTR]: pageId,
            }}
            className={`${styles.pageTextWrap} ${selected ? styles.pageTextWrapSelected : ''}`}
            style={{
              left: rasterPct(box.x, rw),
              top: rasterPct(box.y, rh),
              width: rasterPct(box.width, rw),
              height: rasterPct(box.height, rh),
            }}
          >
            <div
              className={`${styles.pageTextBox} ${selected ? styles.pageTextBoxSelected : ''}`}
              style={{
                color: text.color,
                fontSize: cssFontSize,
                lineHeight: 1.2,
              }}
            >
              {content}
            </div>
          </div>
        );
      })}
    </>
  );
}

type PasteboardTextsLayerProps = {
  frames: StripFrame[];
  pages: EditorDocument['pages'];
  texts: PasteboardText[];
  rasterWidth: number;
  rasterHeight: number;
  selectedTextId: TextId | null;
  selectedTextIds?: TextId[];
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
  liveTextContent?: LiveTextContent | null;
};

function pasteboardWorldItems(input: {
  frames: StripFrame[];
  pages: EditorDocument['pages'];
  texts: PasteboardText[];
  rasterWidth: number;
  rasterHeight: number;
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
}): Array<{ text: PageText | PasteboardText; box: Rect; fontSize: number }> {
  const items: Array<{ text: PageText | PasteboardText; box: Rect; fontSize: number }> = [];
  const frameByPage = new Map<PageId, StripFrame>();
  for (const frame of input.frames) {
    if (frame.slot.kind === 'page') {
      frameByPage.set(frame.slot.pageId, frame);
    }
  }

  for (const text of input.texts) {
    const live = input.textLiveTransforms[text.id];
    if (live?.where === 'page') continue;
    const box =
      live?.where === 'pasteboard'
        ? effectiveTextBox(text.box, live)
        : sanitizeTextBox(text.box);
    items.push({
      text,
      box,
      fontSize: displayTextFontSize(
        (Number.isFinite(text.fontSize) ? text.fontSize : 12) *
          (box.width / Math.max(1, sanitizeTextBox(text.box).width)),
        PAGE_DISPLAY_W / Math.max(1, input.rasterWidth),
      ),
    });
  }

  for (const [pageId, page] of Object.entries(input.pages)) {
    const frame = frameByPage.get(pageId);
    if (!frame) continue;
    for (const text of page.texts) {
      const live = input.textLiveTransforms[text.id];
      if (live?.where !== 'pasteboard') continue;
      const worldBox = pageBoxToWorld(frame, sanitizeTextBox(text.box), input.rasterWidth, input.rasterHeight);
      items.push({
        text,
        box: {
          ...worldBox,
          x: live.x,
          y: live.y,
          width: live.width ?? worldBox.width,
          height: live.height ?? worldBox.height,
        },
        fontSize: text.fontSize * (frame.width / input.rasterWidth),
      });
    }
  }

  return items;
}

/** Texts whose current interaction owner is the infinite pasteboard. */
export function PasteboardTextsLayer({
  frames,
  pages,
  texts,
  rasterWidth,
  rasterHeight,
  selectedTextId,
  selectedTextIds,
  textLiveTransforms,
  liveTextContent: liveTextContentProp,
}: PasteboardTextsLayerProps) {
  const liveFromStore = useLiveTextContent();
  const liveTextContent = liveTextContentProp !== undefined ? liveTextContentProp : liveFromStore;
  const items = pasteboardWorldItems({
    frames,
    pages,
    texts,
    rasterWidth,
    rasterHeight,
    textLiveTransforms,
  });
  const selectedIdSet = new Set(selectedTextIds ?? (selectedTextId ? [selectedTextId] : []));

  return (
    <>
      {items.map(({ text, box: itemBox, fontSize }) => {
        const selected = selectedIdSet.has(text.id);
        const content = liveTextContent?.id === text.id ? liveTextContent.content : text.content;
        const box =
          liveTextContent?.id === text.id ? fitTextBoxToContent(itemBox, content, fontSize) : itemBox;
        return (
          <div
            key={text.id}
            {...{
              [PAGE_TEXT_WRAP_ATTR]: '',
              [PAGE_TEXT_ID_ATTR]: text.id,
            }}
            className={`${styles.pasteboardTextWrap} ${selected ? styles.pageTextWrapSelected : ''}`}
            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          >
            <div
              className={`${styles.pageTextBox} ${selected ? styles.pageTextBoxSelected : ''}`}
              style={{ color: text.color, fontSize, lineHeight: 1.2 }}
            >
              {content}
            </div>
          </div>
        );
      })}
    </>
  );
}

type TextChromeOverlayProps = {
  surfaceRef: RefObject<HTMLDivElement | null>;
  textIds: TextId[];
  zoom: number;
  panX: number;
  panY: number;
  layoutKey: unknown;
  showConfirm?: boolean;
  onDeleteText: (textId: TextId) => void;
  onDuplicateText: (textId: TextId) => void;
};

/** Screen-space chrome. Kept outside `transform: scale` so iPad does not inflate or trap it. */
export function TextChromeOverlay({
  surfaceRef,
  textIds,
  zoom,
  panX,
  panY,
  layoutKey,
  showConfirm,
  onDeleteText,
  onDuplicateText,
}: TextChromeOverlayProps) {
  const [pose, setPose] = useState<{ left: number; top: number; button: number; gap: number } | null>(null);
  const primaryId = textIds[textIds.length - 1];
  const batch = textIds.length > 1;
  const liveTextContent = useLiveTextContent();

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || textIds.length === 0) {
      setPose(null);
      return;
    }
    const wraps = textIds
      .map((id) =>
        surface.querySelector<HTMLElement>(`[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}="${id}"]`),
      )
      .filter((el): el is HTMLElement => el !== null);
    if (wraps.length === 0) {
      setPose(null);
      return;
    }
    const page = surface.querySelector<HTMLElement>(`[${PAGE_INK_FRAME_ATTR}]`);
    const pageWidth =
      page && page.getBoundingClientRect().width > 0
        ? page.getBoundingClientRect().width
        : PAGE_DISPLAY_W * Math.max(0.1, zoom);
    const metrics = textChromeScreenMetrics(pageWidth);
    const surfaceRect = surface.getBoundingClientRect();
    let left = Infinity;
    let top = Infinity;
    for (const wrap of wraps) {
      const wrapRect = wrap.getBoundingClientRect();
      left = Math.min(left, wrapRect.left);
      top = Math.min(top, wrapRect.top);
    }
    setPose({
      left: left - surfaceRect.left,
      top: top - surfaceRect.top - metrics.stack,
      button: metrics.button,
      gap: metrics.gap,
    });
  }, [surfaceRef, textIds, zoom, panX, panY, layoutKey, liveTextContent]);

  if (!pose || !primaryId) {
    return null;
  }

  return (
    <div className={styles.pageTextChromeLayer}>
      <TextBoxChrome
        textId={primaryId}
        buttonPx={pose.button}
        gapPx={pose.gap}
        style={{ left: pose.left, top: pose.top }}
        batch={batch}
        showConfirm={showConfirm}
        onDeleteText={onDeleteText}
        onDuplicateText={onDuplicateText}
      />
    </div>
  );
}

/** @deprecated Texts render inside WorkspaceStrip page frames. Kept for source-level tests. */
export function PageTextOverlay(_props: PageTextOverlayProps) {
  return null;
}

export { PAGE_DISPLAY_H };
