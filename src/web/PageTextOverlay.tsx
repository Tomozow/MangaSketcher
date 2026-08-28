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
import {
  effectiveTextBox,
  sanitizeTextBox,
  textRenderPageId,
  type TextLiveTransform,
} from '@/src/web/text/textLiveTransform';
import {
  PAGE_TEXT_CHROME_ATTR,
  PAGE_TEXT_COPY_ATTR,
  PAGE_TEXT_DELETE_ATTR,
  PAGE_TEXT_ID_ATTR,
  PAGE_TEXT_PAGE_ATTR,
  PAGE_TEXT_WRAP_ATTR,
} from '@/src/web/gestures/pageTextDom';
import { styles } from '@/src/web/editorStyles';
import { PAGE_INK_FRAME_ATTR } from '@/src/web/gestures/pageInkDom';
import { pageBoxToWorld } from '@/src/web/gestures/elementInteraction';

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

function TextBoxChrome({
  textId,
  buttonPx,
  gapPx,
  style,
  onDeleteText,
}: {
  textId: TextId;
  buttonPx: number;
  gapPx: number;
  style?: { left: number; top: number };
  onDeleteText: (textId: TextId) => void;
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
        aria-label="テキストを削除"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDeleteText(textId);
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
        {...{ [PAGE_TEXT_COPY_ATTR]: '' }}
        aria-label="テキストを複製"
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
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

type PageTextsOnFrameProps = {
  pageId: PageId;
  texts: PageText[];
  rasterWidth: number;
  rasterHeight: number;
  selectedTextId: TextId | null;
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
};

/** Page-local text boxes. Must render inside the page frame, not a sibling overlay. */
export function PageTextsOnFrame({
  pageId,
  texts,
  rasterWidth,
  rasterHeight,
  selectedTextId,
  textLiveTransforms,
}: PageTextsOnFrameProps) {
  const rw = rasterSize(rasterWidth, DEFAULT_RASTER_WIDTH);
  const rh = rasterSize(rasterHeight, DEFAULT_RASTER_HEIGHT);
  const scaleX = PAGE_DISPLAY_W / rw;

  return (
    <>
      {texts.map((text) => {
        const selected = selectedTextId === text.id;
        const box = effectiveTextBox(sanitizeTextBox(text.box), textLiveTransforms[text.id]);
        const fontSize = Number.isFinite(text.fontSize) ? text.fontSize : 12;
        const resizeScale = box.width / Math.max(1, sanitizeTextBox(text.box).width);
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
              {text.content}
            </div>
            {selected ? <span className={styles.textResizeHandle} aria-hidden="true" /> : null}
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
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
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
      fontSize: text.fontSize * (box.width / Math.max(1, text.box.width)),
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
  textLiveTransforms,
}: PasteboardTextsLayerProps) {
  const items = pasteboardWorldItems({
    frames,
    pages,
    texts,
    rasterWidth,
    rasterHeight,
    textLiveTransforms,
  });

  return (
    <>
      {items.map(({ text, box, fontSize }) => {
        const selected = selectedTextId === text.id;
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
              {text.content}
            </div>
            {selected ? <span className={styles.textResizeHandle} aria-hidden="true" /> : null}
          </div>
        );
      })}
    </>
  );
}

type TextChromeOverlayProps = {
  surfaceRef: RefObject<HTMLDivElement | null>;
  textId: TextId;
  zoom: number;
  panX: number;
  panY: number;
  layoutKey: unknown;
  onDeleteText: (textId: TextId) => void;
};

/** Screen-space chrome. Kept outside `transform: scale` so iPad does not inflate or trap it. */
export function TextChromeOverlay({
  surfaceRef,
  textId,
  zoom,
  panX,
  panY,
  layoutKey,
  onDeleteText,
}: TextChromeOverlayProps) {
  const [pose, setPose] = useState<{ left: number; top: number; button: number; gap: number } | null>(null);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      setPose(null);
      return;
    }
    const wrap = surface.querySelector<HTMLElement>(
      `[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}="${textId}"]`,
    );
    if (!wrap) {
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
    const wrapRect = wrap.getBoundingClientRect();
    setPose({
      left: wrapRect.left - surfaceRect.left,
      top: wrapRect.top - surfaceRect.top - metrics.stack,
      button: metrics.button,
      gap: metrics.gap,
    });
  }, [surfaceRef, textId, zoom, panX, panY, layoutKey]);

  if (!pose) {
    return null;
  }

  return (
    <div className={styles.pageTextChromeLayer}>
      <TextBoxChrome
        textId={textId}
        buttonPx={pose.button}
        gapPx={pose.gap}
        style={{ left: pose.left, top: pose.top }}
        onDeleteText={onDeleteText}
      />
    </div>
  );
}

/** @deprecated Texts render inside WorkspaceStrip page frames. Kept for source-level tests. */
export function PageTextOverlay(_props: PageTextOverlayProps) {
  return null;
}

export { PAGE_DISPLAY_H };
