'use client';

import { useEffect, useRef, useState } from 'react';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import {
  maxPagesPerColumn,
  MAX_COLUMN_GAP,
  MAX_PAIR_GAP,
  PAGE_DISPLAY_H,
  resolvePagesPerColumn,
} from '@/src/domain/stripGeometry';
import type { EditorDocument } from '@/src/storage/types';
import { styles } from './editorStyles';
import { IconLayout } from './chromeIcons';

type WorkspaceLayoutMenuProps = {
  doc: EditorDocument;
  dispatch: (action: EditorDocumentAction) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function WorkspaceLayoutMenu({ doc, dispatch, open, onOpenChange }: WorkspaceLayoutMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = onOpenChange !== undefined;
  const panelOpen = isControlled ? Boolean(open) : uncontrolledOpen;
  const setPanelOpen = (next: boolean) => {
    if (onOpenChange) {
      onOpenChange(next);
      return;
    }
    setUncontrolledOpen(next);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const pageCount = doc.workspaceOrder.length;
  const maxPages = maxPagesPerColumn(pageCount);
  const pagesPerColumn = resolvePagesPerColumn(doc.pagesPerColumn, pageCount);

  useEffect(() => {
    if (!panelOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setPanelOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [panelOpen, isControlled, onOpenChange]);

  return (
    <div ref={rootRef} className={styles.workspaceLayoutMenu} data-ms-shell="workspace-layout">
      <button
        type="button"
        className={`${styles.chromeIcon} ${panelOpen ? styles.chromeIconPressed : ''}`}
        aria-label="ページレイアウト"
        aria-expanded={panelOpen}
        title="配置"
        onClick={() => setPanelOpen(!panelOpen)}
      >
        <IconLayout />
      </button>
      {panelOpen ? (
        <div className={styles.workspaceLayoutPanel} role="dialog" aria-label="ページレイアウト">
          <div className={styles.sliderBlock}>
            <label className={styles.sliderLabel}>1列のページ数 {pagesPerColumn}</label>
            <input
              className={styles.sliderInput}
              type="range"
              min={1}
              max={maxPages}
              step={2}
              value={pagesPerColumn}
              onChange={(event) => {
                const next = Number(event.target.value);
                dispatch({
                  type: 'setUiLayout',
                  pagesPerColumn: next >= maxPages ? 0 : next,
                });
              }}
            />
          </div>
          <div className={styles.sliderBlock}>
            <label className={styles.sliderLabel}>見開きの間の余白 {Math.round(doc.pairGap)}</label>
            <input
              className={styles.sliderInput}
              type="range"
              min={0}
              max={MAX_PAIR_GAP}
              step={1}
              value={doc.pairGap}
              onChange={(event) =>
                dispatch({ type: 'setUiLayout', pairGap: Number(event.target.value) })
              }
            />
          </div>
          <label className={styles.workspaceLayoutCheck}>
            <input
              type="checkbox"
              checked={doc.showPairDivider}
              onChange={(event) =>
                dispatch({ type: 'setUiLayout', showPairDivider: event.target.checked })
              }
            />
            見開きの間の仕切りを表示
          </label>
          <div className={styles.sliderBlock}>
            <label className={styles.sliderLabel}>
              列の縦余白 {(doc.columnGap / PAGE_DISPLAY_H).toFixed(2)} ページ
            </label>
            <input
              className={styles.sliderInput}
              type="range"
              min={0}
              max={MAX_COLUMN_GAP}
              step={1}
              value={doc.columnGap}
              onChange={(event) =>
                dispatch({ type: 'setUiLayout', columnGap: Number(event.target.value) })
              }
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
