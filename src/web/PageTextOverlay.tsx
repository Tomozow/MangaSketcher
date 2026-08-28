'use client';

import { useEffect } from 'react';
import { DEFAULT_RASTER_HEIGHT, DEFAULT_RASTER_WIDTH, type PageId, type PageText, type TextId } from '@/src/domain/types';
import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from '@/src/domain/stripGeometry';
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
import { PAGE_INK_FRAME_ATTR } from '@/src/web/gestures/pageInkDom';
import styles from '@/src/web/editor.module.css';

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
      if (textRenderPageId(homePageId, textLiveTransforms[text.id]) === framePageId) {
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

  useEffect(() => {
    const selected = texts.find((text) => text.id === selectedTextId);
    if (!selected) {
      return;
    }
    const wrap = document.querySelector<HTMLElement>(`[${PAGE_TEXT_ID_ATTR}="${selected.id}"]`);
    const pageFrame = wrap?.closest<HTMLElement>(`[${PAGE_INK_FRAME_ATTR}]`);
    const appendEl = document.querySelector<HTMLElement>('[aria-label="ページ追加"]');
    const wrapRect = wrap?.getBoundingClientRect();
    const pageRect = pageFrame?.getBoundingClientRect();
    const appendRect = appendEl?.getBoundingClientRect();
    const box = effectiveTextBox(sanitizeTextBox(selected.box), textLiveTransforms[selected.id]);
    const cs = wrap ? getComputedStyle(wrap) : null;
    const pageBottom = pageRect?.bottom;
    const insidePageY = Boolean(
      wrapRect && pageRect && wrapRect.top >= pageRect.top - 1 && wrapRect.top <= pageRect.bottom,
    );
    // #region agent log
    fetch('http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6c5c15'},body:JSON.stringify({sessionId:'6c5c15',location:'PageTextOverlay.tsx:PageTextsOnFrame',message:'selected text vs page vs append',data:{pageId,textId:selected.id,boxX:box.x,boxY:box.y,rw,rh,scaleX,cssLeft:cs?.left,cssTop:cs?.top,wrapLeft:wrapRect?.left,wrapTop:wrapRect?.top,pageLeft:pageRect?.left,pageTop:pageRect?.top,pageRight:pageRect?.right,pageBottom,dy:wrapRect&&pageRect?wrapRect.top-pageRect.top:undefined,insidePageX:Boolean(wrapRect&&pageRect&&wrapRect.left>=pageRect.left-1&&wrapRect.left<=pageRect.right),insidePageY,insideAppend:Boolean(wrapRect&&appendRect&&wrapRect.left>=appendRect.left-8&&wrapRect.left<=appendRect.right+8)},timestamp:Date.now(),hypothesisId:'H',runId:'ipad-fix5'})}).catch(()=>{});
    // #endregion
  }, [pageId, selectedTextId, texts, rw, rh, scaleX, textLiveTransforms]);

  return (
    <>
      {texts.map((text) => {
        const selected = selectedTextId === text.id;
        const box = effectiveTextBox(sanitizeTextBox(text.box), textLiveTransforms[text.id]);
        const fontSize = Number.isFinite(text.fontSize) ? text.fontSize : 12;
        const cssFontSize = displayTextFontSize(fontSize, scaleX);
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
