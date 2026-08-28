'use client';

import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  type PageId,
  type PageText,
  type PasteboardText,
  type TextId,
} from '@/src/domain/types';
import { PAGE_DISPLAY_H, PAGE_DISPLAY_W, type StripFrame } from '@/src/domain/stripGeometry';
import type { EditorDocument } from '@/src/storage/types';
import {
  effectiveTextBox,
  sanitizeTextBox,
  textRenderPageId,
  type TextLiveTransform,
} from '@/src/web/text/textLiveTransform';
import {
  PAGE_TEXT_DELETE_ATTR,
  PAGE_TEXT_ID_ATTR,
  PAGE_TEXT_PAGE_ATTR,
  PAGE_TEXT_WRAP_ATTR,
} from '@/src/web/gestures/pageTextDom';
import styles from '@/src/web/editor.module.css';
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

type PageTextsOnFrameProps = {
  pageId: PageId;
  texts: PageText[];
  rasterWidth: number;
  rasterHeight: number;
  selectedTextId: TextId | null;
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
  onDeleteText: (textId: TextId) => void;
};

function rasterSize(value: number, fallback: number): number {
  return value > 0 ? value : fallback;
}

function rasterPct(value: number, raster: number): string {
  return `${(value / raster) * 100}%`;
}

/** Page-local text boxes. Must render inside the page frame, not a sibling overlay. */
export function PageTextsOnFrame({
  pageId,
  texts,
  rasterWidth,
  rasterHeight,
  selectedTextId,
  textLiveTransforms,
  onDeleteText,
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
            {selected ? (
              <button
                type="button"
                className={styles.pageTextDeleteButton}
                {...{ [PAGE_TEXT_DELETE_ATTR]: '' }}
                aria-label="テキストを削除"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteText(text.id);
                }}
              >
                ×
              </button>
            ) : null}
            <div
              className={`${styles.pageTextBox} ${selected ? styles.pageTextBoxSelected : ''}`}
              style={{
                width: '100%',
                height: '100%',
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
  onDeleteText: (textId: TextId) => void;
};

/** Texts whose current interaction owner is the infinite pasteboard. */
export function PasteboardTextsLayer({
  frames,
  pages,
  texts,
  rasterWidth,
  rasterHeight,
  selectedTextId,
  textLiveTransforms,
  onDeleteText,
}: PasteboardTextsLayerProps) {
  const items: Array<{ text: PageText | PasteboardText; box: { x: number; y: number; width: number; height: number }; fontSize: number }> = [];
  const frameByPage = new Map<PageId, StripFrame>();
  for (const frame of frames) {
    if (frame.slot.kind === 'page') {
      frameByPage.set(frame.slot.pageId, frame);
    }
  }

  for (const text of texts) {
    const live = textLiveTransforms[text.id];
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

  for (const [pageId, page] of Object.entries(pages)) {
    const frame = frameByPage.get(pageId);
    if (!frame) continue;
    for (const text of page.texts) {
      const live = textLiveTransforms[text.id];
      if (live?.where !== 'pasteboard') continue;
      const worldBox = pageBoxToWorld(frame, sanitizeTextBox(text.box), rasterWidth, rasterHeight);
      items.push({
        text,
        box: {
          ...worldBox,
          x: live.x,
          y: live.y,
          width: live.width ?? worldBox.width,
          height: live.height ?? worldBox.height,
        },
        fontSize: text.fontSize * (frame.width / rasterWidth),
      });
    }
  }

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
            {selected ? (
              <button
                type="button"
                className={styles.pageTextDeleteButton}
                {...{ [PAGE_TEXT_DELETE_ATTR]: '' }}
                aria-label="テキストを削除"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteText(text.id);
                }}
              >
                ×
              </button>
            ) : null}
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

/** @deprecated Texts render inside WorkspaceStrip page frames. Kept for source-level tests. */
export function PageTextOverlay(_props: PageTextOverlayProps) {
  return null;
}

export { PAGE_DISPLAY_H };
