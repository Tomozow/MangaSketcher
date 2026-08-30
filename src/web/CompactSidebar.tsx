'use client';

import { useMemo, useState } from 'react';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import { selectTargetFlagsOf, type ToolId } from '@/src/domain/types';
import { findText, selectedTextIdsOf } from '@/src/domain/text';
import { inkPalette } from '@/src/theme/tokens';
import type { EditorDocument, EditorHistory } from '@/src/storage/types';
import { historyControlsDisabled } from './historyControls';
import { ValueSlider } from './ValueSlider';
import { styles } from './editorStyles';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'pen', label: 'ペン' },
  { id: 'eraser', label: '消' },
  { id: 'text', label: '文' },
  { id: 'select', label: '選' },
];

const SELECT_FILTERS: { key: 'selectText' | 'selectInk' | 'selectClip'; label: string }[] = [
  { key: 'selectText', label: 'テキスト' },
  { key: 'selectInk', label: '線画' },
  { key: 'selectClip', label: 'クリップ' },
];

type CompactSidebarProps = {
  doc: EditorDocument;
  history: EditorHistory;
  textEditing: boolean;
  dispatch: (action: EditorDocumentAction) => void;
  onUndo: () => void;
  onRedo: () => void;
};

const ERASER_SIZE_MAX = 128;

export function CompactSidebar({
  doc,
  history,
  textEditing,
  dispatch,
  onUndo,
  onRedo,
}: CompactSidebarProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  const selectTargets = selectTargetFlagsOf(doc.tools);
  const selectedTextIds = selectedTextIdsOf(doc);
  const primarySelectedText =
    doc.tool === 'select' && selectedTextIds.length > 0
      ? findText(doc, selectedTextIds[selectedTextIds.length - 1]!)
      : null;
  const showSelectTextSize = Boolean(primarySelectedText);
  const showSize = doc.tool !== 'select' || showSelectTextSize;
  const showColor = doc.tool === 'pen' || doc.tool === 'text';

  const activeColor = useMemo(() => {
    if (doc.tool === 'text') {
      return doc.tools.textColor;
    }
    if (doc.tool === 'eraser' || doc.tool === 'select') {
      return '#FFFFFF';
    }
    return doc.tools.penColor;
  }, [doc.tool, doc.tools.penColor, doc.tools.textColor]);

  const sizeValue =
    doc.tool === 'eraser'
      ? doc.tools.eraserSize
      : doc.tool === 'text'
        ? doc.tools.textFontSize
        : doc.tool === 'select' && primarySelectedText
          ? primarySelectedText.node.fontSize
          : doc.tools.penSize;
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
    if (doc.tool === 'select' && selectedTextIds.length > 0) {
      dispatch({ type: 'setTextsFontSize', textIds: selectedTextIds, fontSize: value });
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

      {doc.tool === 'select' ? (
        <div className={styles.selectFilterRow} role="group" aria-label="選択対象">
          {SELECT_FILTERS.map((filter) => {
            const on =
              filter.key === 'selectText'
                ? selectTargets.text
                : filter.key === 'selectInk'
                  ? selectTargets.ink
                  : selectTargets.clip;
            return (
              <button
                key={filter.key}
                type="button"
                className={`${styles.selectFilterButton} ${on ? styles.toolButtonActive : ''}`}
                aria-pressed={on}
                aria-label={filter.label}
                onClick={() => dispatch({ type: 'setToolProperties', patch: { [filter.key]: !on } })}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {showSize ? (
      <ValueSlider
        label={doc.tool === 'text' || doc.tool === 'select' ? 'サイズ' : doc.tool === 'eraser' ? '消し' : '筆'}
        min={doc.tool === 'text' || doc.tool === 'select' ? 12 : 1}
        max={doc.tool === 'text' || doc.tool === 'select' ? 96 : doc.tool === 'eraser' ? ERASER_SIZE_MAX : 64}
        step={1}
        value={sizeValue}
        onChange={handleSizeChange}
      />
      ) : null}

      {showOpacity ? (
        <ValueSlider label="不透明度" min={0.05} max={1} step={0.05} value={opacityValue} onChange={handleOpacityChange} />
      ) : null}

      {showOpacity ? (
        <button
          type="button"
          className={`${styles.iconButton} ${doc.tools.pressureEnabled !== false ? styles.iconButtonActive : ''}`}
          aria-pressed={doc.tools.pressureEnabled !== false}
          aria-label="筆圧"
          onClick={() =>
            dispatch({
              type: 'setToolProperties',
              patch: { pressureEnabled: doc.tools.pressureEnabled === false },
            })
          }
        >
          圧
        </button>
      ) : null}

      {showColor ? (
        <div className={styles.colorRow}>
          <button
            type="button"
            className={styles.colorSwatch}
            style={{ background: activeColor }}
            onClick={() => setPaletteOpen((open) => !open)}
            aria-label="カラーパレット"
          />
        </div>
      ) : null}

      {showColor && paletteOpen ? (
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
          className={`${styles.iconButton} ${doc.pdfViewerVisible ? styles.iconButtonActive : ''}`}
          onClick={() => dispatch({ type: 'setUiLayout', pdfViewerVisible: !doc.pdfViewerVisible })}
          aria-label="PDF 表示切替"
        >
          PDF
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${doc.stockPane === 'trash' ? styles.iconButtonActive : ''}`}
          onClick={() =>
            dispatch({
              type: 'setUiLayout',
              stockPane: doc.stockPane === 'trash' ? 'stock' : 'trash',
            })
          }
          aria-label="ゴミ箱"
        >
          ゴミ箱
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => dispatch({ type: 'setUiLayout', sidebarCompact: !doc.sidebarCompact })}
          aria-label="サイドバー幅切替"
        >
          {doc.sidebarCompact ? '広' : '狭'}
        </button>
        {doc.stockPane !== 'trash' ? (
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
        ) : null}
      </div>
    </div>
  );
}
