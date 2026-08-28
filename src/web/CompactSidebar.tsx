'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import type { ToolId } from '@/src/domain/types';
import { inkPalette } from '@/src/theme/tokens';
import type { AutosaveStatus } from '@/src/storage/autosave';
import type { EditorDocument, EditorHistory } from '@/src/storage/types';
import { historyControlsDisabled } from './historyControls';
import { ValueSlider } from './ValueSlider';
import styles from './editor.module.css';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'pen', label: 'ペン' },
  { id: 'eraser', label: '消' },
  { id: 'text', label: '文' },
  { id: 'select', label: '選' },
];

type CompactSidebarProps = {
  doc: EditorDocument;
  history: EditorHistory;
  textEditing: boolean;
  autosaveStatus: AutosaveStatus;
  dispatch: (action: EditorDocumentAction) => void;
  onUndo: () => void;
  onRedo: () => void;
};

const ERASER_SIZE_MAX = 128;

export function CompactSidebar({
  doc,
  history,
  textEditing,
  autosaveStatus,
  dispatch,
  onUndo,
  onRedo,
}: CompactSidebarProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeColor = useMemo(() => {
    if (doc.tool === 'text') {
      return doc.tools.textColor;
    }
    if (doc.tool === 'eraser') {
      return '#FFFFFF';
    }
    return doc.tools.penColor;
  }, [doc.tool, doc.tools.penColor, doc.tools.textColor]);

  const sizeValue = doc.tool === 'eraser' ? doc.tools.eraserSize : doc.tool === 'text' ? doc.tools.textFontSize : doc.tools.penSize;
  const opacityValue = doc.tool === 'eraser' ? doc.tools.eraserOpacity : doc.tools.penOpacity;
  const showOpacity = doc.tool === 'pen' || doc.tool === 'eraser';

  const handleSizeChange = (value: number) => {
    if (doc.tool === 'eraser') {
      dispatch({ type: 'setToolProperties', patch: { eraserSize: value } });
      return;
    }
    if (doc.tool === 'text') {
      dispatch({ type: 'setToolProperties', patch: { textFontSize: value } });
      return;
    }
    dispatch({ type: 'setToolProperties', patch: { penSize: value } });
  };

  const handleOpacityChange = (value: number) => {
    if (doc.tool === 'eraser') {
      dispatch({ type: 'setToolProperties', patch: { eraserOpacity: value } });
      return;
    }
    dispatch({ type: 'setToolProperties', patch: { penOpacity: value } });
  };

  const handleColorPick = (color: string) => {
    if (doc.tool === 'text') {
      dispatch({ type: 'setToolProperties', patch: { textColor: color } });
    } else {
      dispatch({ type: 'setToolProperties', patch: { penColor: color } });
    }
    setPaletteOpen(false);
  };

  return (
    <div className={styles.sidebar}>
      {(autosaveStatus.unsaved || autosaveStatus.encodingCount > 0) && (
        <div className={styles.saveStatusRow} aria-live="polite">
          <span
            className={`${styles.saveStatusDot} ${
              autosaveStatus.encodingCount > 0 ? styles.saveStatusEncoding : styles.saveStatusUnsaved
            }`}
            aria-hidden
          />
          <span className={styles.saveStatusLabel}>
            {autosaveStatus.encodingCount > 0 ? 'エンコード中' : '未保存'}
          </span>
        </div>
      )}
      <div className={styles.toolRow}>
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`${styles.toolButton} ${doc.tool === tool.id ? styles.toolButtonActive : ''}`}
            onClick={() => dispatch({ type: 'setTool', tool: tool.id })}
            aria-label={tool.label}
          >
            {tool.label}
          </button>
        ))}
      </div>

      <ValueSlider
        label={doc.tool === 'text' ? 'サイズ' : doc.tool === 'eraser' ? '消し' : '筆'}
        min={doc.tool === 'text' ? 12 : 1}
        max={doc.tool === 'text' ? 96 : doc.tool === 'eraser' ? ERASER_SIZE_MAX : 64}
        step={1}
        value={sizeValue}
        onChange={handleSizeChange}
      />

      {showOpacity ? (
        <ValueSlider label="不透明度" min={0.05} max={1} step={0.05} value={opacityValue} onChange={handleOpacityChange} />
      ) : null}

      <div className={styles.colorRow}>
        <button
          type="button"
          className={styles.colorSwatch}
          style={{ background: activeColor }}
          onClick={() => setPaletteOpen((open) => !open)}
          aria-label="カラーパレット"
        />
      </div>

      {paletteOpen ? (
        <div className={styles.palettePopover}>
          {inkPalette.map((color) => (
            <button
              key={color}
              type="button"
              className={styles.paletteChip}
              style={{ background: color }}
              onClick={() => handleColorPick(color)}
              aria-label={`色 ${color}`}
            />
          ))}
        </div>
      ) : null}

      <div className={styles.actionRow}>
        <button type="button" className={styles.iconButton} disabled={historyControlsDisabled(textEditing, history.past.length)} onClick={onUndo}>
          ↶
        </button>
        <button type="button" className={styles.iconButton} disabled={historyControlsDisabled(textEditing, history.future.length)} onClick={onRedo}>
          ↷
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => dispatch({ type: 'setUiLayout', pdfViewerVisible: !doc.pdfViewerVisible })}
          aria-label="PDF 表示切替"
        >
          PDF
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => dispatch({ type: 'setUiLayout', sidebarCompact: !doc.sidebarCompact })}
          aria-label="サイドバー幅切替"
        >
          {doc.sidebarCompact ? '広' : '狭'}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() =>
            dispatch({
              type: 'setUiLayout',
              stockLayout: doc.stockLayout === 'grid' ? 'free' : 'grid',
            })
          }
          aria-label="ストック表示切替"
        >
          {doc.stockLayout === 'grid' ? '自由' : '整列'}
        </button>
        <Link href="/" className={styles.linkButton}>
          一覧
        </Link>
      </div>
    </div>
  );
}
