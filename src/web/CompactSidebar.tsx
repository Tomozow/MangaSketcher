'use client';

import { useMemo } from 'react';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import { selectTargetFlagsOf, type ToolId } from '@/src/domain/types';
import { findText, selectedTextIdsOf } from '@/src/domain/text';
import { inkPalette } from '@/src/theme/tokens';
import type { EditorDocument, EditorHistory } from '@/src/storage/types';
import { historyControlsDisabled } from './historyControls';
import { ValueSlider } from './ValueSlider';
import { styles } from './editorStyles';
import {
  IconEraser,
  IconPen,
  IconRedo,
  IconSelect,
  IconText,
  IconUndo,
} from './chromeIcons';

const TOOLS: { id: ToolId; label: string; shortcut: string }[] = [
  { id: 'pen', label: 'ペン', shortcut: 'B' },
  { id: 'eraser', label: '消', shortcut: 'E' },
  { id: 'text', label: '文', shortcut: 'T' },
  { id: 'select', label: '選', shortcut: 'C' },
];

const TOOL_FLYOUT_TITLES: Record<ToolId, string> = {
  pen: 'ペン',
  eraser: '消しゴム',
  text: 'テキスト',
  select: '選択',
};

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

function ToolGlyph({ id }: { id: ToolId }) {
  if (id === 'pen') {
    return <IconPen />;
  }
  if (id === 'eraser') {
    return <IconEraser />;
  }
  if (id === 'text') {
    return <IconText />;
  }
  return <IconSelect />;
}

export function CompactSidebar({
  doc,
  history,
  textEditing,
  dispatch,
  onUndo,
  onRedo,
}: CompactSidebarProps) {
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
  const pressureOn = doc.tools.pressureEnabled !== false;

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
  };

  return (
    <>
      <div className={styles.toolRail} role="toolbar" aria-label="ツール">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`${styles.chromeIcon} ${doc.tool === tool.id ? styles.toolRailActive : ''}`}
            onClick={() => dispatch({ type: 'setTool', tool: tool.id })}
            aria-label={`${tool.label}（${tool.shortcut}）`}
            aria-pressed={doc.tool === tool.id}
            title={`${TOOL_FLYOUT_TITLES[tool.id]}（${tool.shortcut}）`}
          >
            <ToolGlyph id={tool.id} />
          </button>
        ))}
        <hr className={styles.toolRailRule} />
        <button
          type="button"
          className={styles.chromeIcon}
          disabled={historyControlsDisabled(textEditing, history.past.length)}
          onClick={onUndo}
          aria-label="取り消し（W / Ctrl+Z）"
          title="取り消し（W / Ctrl+Z）"
        >
          <IconUndo />
        </button>
        <button
          type="button"
          className={styles.chromeIcon}
          disabled={historyControlsDisabled(textEditing, history.future.length)}
          onClick={onRedo}
          aria-label="やり直し（S / Ctrl+Y）"
          title="やり直し（S / Ctrl+Y）"
        >
          <IconRedo />
        </button>
      </div>

      <aside className={styles.toolFlyout} aria-label={`${TOOL_FLYOUT_TITLES[doc.tool]}の設定`}>
        <h4 className={styles.toolFlyoutTitle}>{TOOL_FLYOUT_TITLES[doc.tool]}</h4>

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
            label={doc.tool === 'eraser' ? '消し' : 'サイズ'}
            min={doc.tool === 'text' || doc.tool === 'select' ? 12 : 1}
            max={doc.tool === 'text' || doc.tool === 'select' ? 96 : doc.tool === 'eraser' ? ERASER_SIZE_MAX : 64}
            step={1}
            value={sizeValue}
            onChange={handleSizeChange}
          />
        ) : null}

        {showOpacity ? (
          <ValueSlider
            label="不透明度"
            min={0.05}
            max={1}
            step={0.05}
            value={opacityValue}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={handleOpacityChange}
          />
        ) : null}

        {showOpacity ? (
          <button
            type="button"
            className={`${styles.pressureToggle} ${pressureOn ? styles.pressureToggleOn : ''}`}
            aria-pressed={pressureOn}
            aria-label="筆圧"
            onClick={() =>
              dispatch({
                type: 'setToolProperties',
                patch: { pressureEnabled: doc.tools.pressureEnabled === false },
              })
            }
          >
            {pressureOn ? '筆圧オン' : '筆圧オフ'}
          </button>
        ) : null}

        {showColor ? (
          <div className={styles.palettePopover}>
            {inkPalette.map((color) => (
              <button
                key={color}
                type="button"
                className={`${styles.paletteChip} ${activeColor.toUpperCase() === color.toUpperCase() ? styles.paletteChipOn : ''}`}
                style={{ background: color }}
                onClick={() => handleColorPick(color)}
                aria-label={`色 ${color}`}
                aria-pressed={activeColor.toUpperCase() === color.toUpperCase()}
              />
            ))}
          </div>
        ) : null}
      </aside>
    </>
  );
}
