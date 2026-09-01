'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { PageId } from '@/src/domain/types';
import { PAGE_INK_FRAME_ATTR } from '@/src/web/gestures/pageInkDom';
import { PAGE_DELETE_CHROME_ATTR } from '@/src/web/gestures/pageTextDom';
import {
  clampOverlayBox,
  clientBoxToLocal,
  intersectOverlayBoxes,
  OVERLAY_CLAMP_MARGIN_PX,
  subtractHorizontalObstacle,
  type OverlayBox,
} from '@/src/web/overlayClamp';
import { styles } from './editorStyles';

type PageChromeButtonsProps = {
  onInsert?: () => void;
  onMoveToStock?: () => void;
  onDelete?: () => void;
  onClearInk?: () => void;
  className?: string;
  style?: CSSProperties;
  rowRef?: RefObject<HTMLDivElement | null>;
};

function stopPointer(event: ReactPointerEvent) {
  event.stopPropagation();
}

export function PageChromeButtons({
  onInsert,
  onMoveToStock,
  onDelete,
  onClearInk,
  className,
  style,
  rowRef,
}: PageChromeButtonsProps) {
  if (!onInsert && !onMoveToStock && !onDelete && !onClearInk) {
    return null;
  }
  return (
    <div
      ref={rowRef}
      className={className ? `${styles.pageChromeRow} ${className}` : styles.pageChromeRow}
      style={style}
      {...{ [PAGE_DELETE_CHROME_ATTR]: '' }}
      onPointerDown={stopPointer}
    >
      {onInsert ? (
        <button
          type="button"
          className={styles.pageDeleteButton}
          aria-label="ページを挿入"
          onClick={(event) => {
            event.stopPropagation();
            onInsert();
          }}
        >
          挿入
        </button>
      ) : null}
      {onMoveToStock ? (
        <button
          type="button"
          className={styles.pageDeleteButton}
          aria-label="ストックへ移動"
          onClick={(event) => {
            event.stopPropagation();
            onMoveToStock();
          }}
        >
          ストックへ移動
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className={styles.pageDeleteButton}
          aria-label="ページを削除"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          削除
        </button>
      ) : null}
      {onClearInk ? (
        <button
          type="button"
          className={styles.pageDeleteButton}
          aria-label="線画を削除"
          onClick={(event) => {
            event.stopPropagation();
            onClearInk();
          }}
        >
          線画を削除
        </button>
      ) : null}
    </div>
  );
}

function visualViewportBox(): OverlayBox {
  if (typeof window === 'undefined') {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const viewport = window.visualViewport;
  if (!viewport) {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  return {
    left: viewport.offsetLeft,
    top: viewport.offsetTop,
    width: viewport.width,
    height: viewport.height,
  };
}

function pageChromeView(surface: HTMLElement): OverlayBox {
  const origin = surface.getBoundingClientRect();
  let view = clientBoxToLocal(origin, origin);
  const pane = document.getElementById('editor-workspace-pane');
  if (pane) {
    view = intersectOverlayBoxes(view, clientBoxToLocal(pane.getBoundingClientRect(), origin));
  }
  view = intersectOverlayBoxes(view, clientBoxToLocal(visualViewportBox(), origin));
  const rail = document.querySelector<HTMLElement>('.ms-leftChrome');
  if (rail) {
    view = subtractHorizontalObstacle(view, clientBoxToLocal(rail.getBoundingClientRect(), origin));
  }
  return view;
}

function posesClose(
  a: { left: number; top: number; maxWidth: number | null },
  b: { left: number; top: number; maxWidth: number | null },
): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    a.maxWidth === b.maxWidth
  );
}

type PageChromeOverlayProps = {
  surfaceRef: RefObject<HTMLElement | null>;
  pageId: PageId;
  zoom: number;
  panX: number;
  panY: number;
  onInsert?: () => void;
  onMoveToStock?: () => void;
  onDelete?: () => void;
  onClearInk?: () => void;
};

/** Screen-space page chrome. Kept outside `transform: scale` so zoom does not inflate it. */
export function PageChromeOverlay({
  surfaceRef,
  pageId,
  zoom,
  panX,
  panY,
  onInsert,
  onMoveToStock,
  onDelete,
  onClearInk,
}: PageChromeOverlayProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<{ left: number; top: number; maxWidth: number | null } | null>(null);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      setPose(null);
      return;
    }
    const page = surface.querySelector<HTMLElement>(`[${PAGE_INK_FRAME_ATTR}="${pageId}"]`);
    if (!page) {
      setPose(null);
      return;
    }
    const pageRect = page.getBoundingClientRect();
    const origin = surface.getBoundingClientRect();
    const preferredCenter = pageRect.left - origin.left + pageRect.width / 2;
    const preferredTop = pageRect.top - origin.top + OVERLAY_CLAMP_MARGIN_PX;
    const preferred = { left: preferredCenter, top: preferredTop, maxWidth: null as number | null };
    const row = rowRef.current;
    if (!row) {
      setPose((prev) => (prev && posesClose(prev, preferred) ? prev : preferred));
      return;
    }

    const prevMax = row.style.maxWidth;
    const prevWrap = row.style.flexWrap;
    const prevWhite = row.style.whiteSpace;
    row.style.maxWidth = 'none';
    row.style.flexWrap = 'nowrap';
    row.style.whiteSpace = 'nowrap';
    let width = row.offsetWidth;
    let height = row.offsetHeight;
    const view = pageChromeView(surface);
    const budget = Math.max(0, view.width - OVERLAY_CLAMP_MARGIN_PX * 2);
    const maxWidth = width > budget ? budget : null;
    if (maxWidth != null) {
      row.style.maxWidth = `${maxWidth}px`;
      row.style.flexWrap = 'wrap';
      row.style.whiteSpace = 'normal';
      width = row.offsetWidth;
      height = row.offsetHeight;
    }
    row.style.maxWidth = prevMax;
    row.style.flexWrap = prevWrap;
    row.style.whiteSpace = prevWhite;

    const clamped = clampOverlayBox(
      {
        left: preferredCenter - width / 2,
        top: preferredTop,
        width,
        height,
      },
      view,
    );
    const next = {
      left: clamped.left + clamped.width / 2,
      top: clamped.top,
      maxWidth,
    };
    setPose((prev) => (prev && posesClose(prev, next) ? prev : next));
  }, [surfaceRef, pageId, zoom, panX, panY, pose == null]);

  if (!pose) {
    return null;
  }

  return (
    <div className={styles.pageTextChromeLayer}>
      <PageChromeButtons
        rowRef={rowRef}
        className={styles.pageChromeRowScreen}
        style={{
          left: pose.left,
          top: pose.top,
          maxWidth: pose.maxWidth ?? undefined,
          flexWrap: pose.maxWidth != null ? 'wrap' : 'nowrap',
          whiteSpace: pose.maxWidth != null ? 'normal' : 'nowrap',
        }}
        onInsert={onInsert}
        onMoveToStock={onMoveToStock}
        onDelete={onDelete}
        onClearInk={onClearInk}
      />
    </div>
  );
}
