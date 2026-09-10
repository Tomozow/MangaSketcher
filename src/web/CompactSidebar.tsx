'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import { isLassoSelectMode, isSelectionTool, scissorsTargetFlagsOf, selectTargetFlagsOf, type ToolId, type WritingMode, writingModeOf } from '@/src/domain/types';
import { findText, selectedTextIdsOf } from '@/src/domain/text';
import { PAGE_TEXT_CHROME_ATTR } from '@/src/web/gestures/pageTextDom';
import { inkPalette } from '@/src/theme/tokens';
import type { EditorDocument, EditorHistory } from '@/src/storage/types';
import {
  ERASER_SIZE_MAX,
  PEN_SIZE_MAX,
  shortcutLabelFromCode,
  type BoolPresets,
  type PenSizePresets,
  type ShortcutMap,
} from '@/src/storage/appSettings';
import { historyControlsDisabled } from './historyControls';
import { InkSizePreview, INK_SIZE_PREVIEW_HIDE_MS, inkSizePreviewDiameterPx } from './InkSizePreview';
import { PenSizePresetRow } from './PenSizePresets';
import { ValueSlider } from './ValueSlider';
import { styles } from './editorStyles';
import { useAppSettings } from './useAppSettings';
import {
  IconEraser,
  IconLasso,
  IconPen,
  IconRedo,
  IconScissors,
  IconSelect,
  IconText,
  IconUndo,
} from './chromeIcons';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'pen', label: 'ペン' },
  { id: 'eraser', label: '消' },
  { id: 'text', label: '文' },
  { id: 'select', label: '選' },
  { id: 'scissors', label: '鋏' },
];

const TOOL_FLYOUT_TITLES: Record<ToolId, string> = {
  pen: 'ペン',
  eraser: '消しゴム',
  text: 'テキスト',
  select: '選択',
  lasso: '投げ縄',
  scissors: 'ハサミ',
};

const SELECT_FILTERS: { key: 'selectText' | 'selectInk' | 'selectClip'; label: string }[] = [
  { key: 'selectText', label: 'テキスト' },
  { key: 'selectInk', label: '線画' },
  { key: 'selectClip', label: 'クリップ' },
];

const SCISSORS_FILTERS: { key: 'scissorsSelectText' | 'scissorsSelectInk' | 'scissorsSelectClip'; label: string }[] = [
  { key: 'scissorsSelectText', label: 'テキスト' },
  { key: 'scissorsSelectInk', label: '線画' },
  { key: 'scissorsSelectClip', label: 'クリップ' },
];

type CompactSidebarProps = {
  doc: EditorDocument;
  history: EditorHistory;
  textEditing: boolean;
  dispatch: (action: EditorDocumentAction) => void;
  onUndo: () => void;
  onRedo: () => void;
  shortcuts: ShortcutMap;
  toolFlyoutOnFirstTap?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

function patchPreset(quad: PenSizePresets, index: number, value: number): PenSizePresets {
  const next: PenSizePresets = [...quad];
  next[index] = value;
  return next;
}

function patchBoolPreset(quad: BoolPresets, index: number, value: boolean): BoolPresets {
  const next: BoolPresets = [...quad];
  next[index] = value;
  return next;
}

function ToolGlyph({ id, lasso }: { id: ToolId; lasso?: boolean }) {
  if (id === 'pen') {
    return <IconPen />;
  }
  if (id === 'eraser') {
    return <IconEraser />;
  }
  if (id === 'text') {
    return <IconText />;
  }
  if (id === 'scissors') {
    return <IconScissors />;
  }
  if (id === 'lasso' || lasso) {
    return <IconLasso />;
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
  shortcuts,
  toolFlyoutOnFirstTap = false,
  leading,
  trailing,
}: CompactSidebarProps) {
  const [appSettings, updateAppSettings] = useAppSettings();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const selectedToolRef = useRef(doc.tool);
  const previewHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inkSizePreview, setInkSizePreview] = useState<{
    key: number;
    kind: 'pen' | 'eraser';
    diameter: number;
    color: string;
    opacity: number;
    size: number;
  } | null>(null);

  const showInkSizePreview = (
    kind: 'pen' | 'eraser',
    size: number,
    color: string,
    opacity: number,
  ) => {
    setInkSizePreview((prev) => ({
      key: (prev?.key ?? 0) + 1,
      kind,
      diameter: inkSizePreviewDiameterPx(size, doc.workspaceZoom, doc.rasterWidth),
      color,
      opacity,
      size,
    }));
    if (previewHideRef.current) {
      clearTimeout(previewHideRef.current);
    }
    previewHideRef.current = setTimeout(() => {
      setInkSizePreview(null);
      previewHideRef.current = null;
    }, INK_SIZE_PREVIEW_HIDE_MS);
  };

  useEffect(() => {
    return () => {
      if (previewHideRef.current) {
        clearTimeout(previewHideRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedToolRef.current === doc.tool) {
      return;
    }
    selectedToolRef.current = doc.tool;
    setFlyoutOpen(toolFlyoutOnFirstTap);
  }, [doc.tool, toolFlyoutOnFirstTap]);

  const selectTargets = selectTargetFlagsOf(doc.tools);
  const selectedTextIds = selectedTextIdsOf(doc);
  const selectionTool = isSelectionTool(doc.tool);
  const lassoSelect = isLassoSelectMode(doc.tool, doc.tools);
  const scissorsLasso = doc.tools.scissorsLasso === true;
  const scissorsTargets = scissorsTargetFlagsOf(doc.tools);
  const scissorsSwitchToSelect = doc.tools.scissorsSwitchToSelect === true;
  const primarySelectedText =
    selectedTextIds.length > 0
      ? findText(doc, selectedTextIds[selectedTextIds.length - 1]!)
      : null;
  const showSelectTextSize = Boolean(primarySelectedText);
  const showWritingMode = doc.tool === 'text' || showSelectTextSize;
  const activeWritingMode: WritingMode =
    (doc.tool === 'text' || selectionTool) && selectedTextIds.length > 0
      ? writingModeOf(findText(doc, selectedTextIds[selectedTextIds.length - 1]!)?.node.writingMode)
      : writingModeOf(doc.tools.textWritingMode);
  const showSize = doc.tool !== 'scissors' && (!selectionTool || showSelectTextSize);
  const showColor = doc.tool === 'pen' || doc.tool === 'text';

  const activeColor = useMemo(() => {
    if (doc.tool === 'text') {
      return doc.tools.textColor;
    }
    if (doc.tool === 'eraser' || selectionTool) {
      return '#FFFFFF';
    }
    return doc.tools.penColor;
  }, [doc.tool, doc.tools.penColor, doc.tools.textColor, selectionTool]);

  const sizeValue =
    (doc.tool === 'text' || selectionTool) && primarySelectedText
      ? primarySelectedText.node.fontSize
      : doc.tool === 'text'
        ? doc.tools.textFontSize
        : doc.tools.penSize;

  const handleSizeChange = (value: number) => {
    if (doc.tool === 'text') {
      dispatch({ type: 'setToolProperties', patch: { textFontSize: value } });
      if (selectedTextIds.length > 0) {
        dispatch({ type: 'setTextsFontSize', textIds: selectedTextIds, fontSize: value });
      }
      return;
    }
    if (selectionTool && selectedTextIds.length > 0) {
      dispatch({ type: 'setTextsFontSize', textIds: selectedTextIds, fontSize: value });
      return;
    }
    dispatch({ type: 'setToolProperties', patch: { penSize: value } });
  };

  const handleColorPick = (color: string) => {
    if (doc.tool === 'text') {
      dispatch({ type: 'setToolProperties', patch: { textColor: color } });
    } else {
      dispatch({ type: 'setToolProperties', patch: { penColor: color } });
    }
  };

  const handleWritingMode = (mode: WritingMode) => {
    if ((doc.tool === 'text' || selectionTool) && selectedTextIds.length > 0) {
      dispatch({ type: 'setTextsWritingMode', textIds: selectedTextIds, writingMode: mode });
    }
    if (doc.tool === 'text') {
      dispatch({ type: 'setToolProperties', patch: { textWritingMode: mode } });
    }
  };

  const writingModeRow = showWritingMode ? (
    <div className={styles.toolFlyoutSection}>
      <div className={styles.penPresetLabel}>向き</div>
      <div className={styles.selectFilterRow} role="group" aria-label="書き方向">
        <button
          type="button"
          className={`${styles.selectFilterButton} ${activeWritingMode === 'vertical' ? styles.toolButtonActive : ''}`}
          aria-pressed={activeWritingMode === 'vertical'}
          aria-label="縦書き"
          onClick={() => handleWritingMode('vertical')}
        >
          縦
        </button>
        <button
          type="button"
          className={`${styles.selectFilterButton} ${activeWritingMode === 'horizontal' ? styles.toolButtonActive : ''}`}
          aria-pressed={activeWritingMode === 'horizontal'}
          aria-label="横書き"
          onClick={() => handleWritingMode('horizontal')}
        >
          横
        </button>
      </div>
    </div>
  ) : null;

  const inkPresetIndex =
    doc.tool === 'eraser' ? appSettings.eraserSizePresetIndex : appSettings.penSizePresetIndex;
  const inkPressureSize =
    doc.tool === 'eraser'
      ? appSettings.eraserPressureSize[inkPresetIndex]!
      : appSettings.penPressureSize[inkPresetIndex]!;
  const inkPressureOpacity =
    doc.tool === 'eraser'
      ? appSettings.eraserPressureOpacity[inkPresetIndex]!
      : appSettings.penPressureOpacity[inkPresetIndex]!;

  return (
    <>
    {inkSizePreview ? (
      <InkSizePreview
        key={inkSizePreview.key}
        kind={inkSizePreview.kind}
        diameter={inkSizePreview.diameter}
        color={inkSizePreview.color}
        opacity={inkSizePreview.opacity}
        size={inkSizePreview.size}
      />
    ) : null}
    <div className={styles.leftChrome}>
      {leading}
      <div className={styles.toolRailCluster}>
      <div className={styles.toolRail} role="toolbar" aria-label="ツール">
        {TOOLS.map((tool) => {
          const shortcut = shortcutLabelFromCode(shortcuts[tool.id]);
          const railActive = tool.id === 'select' ? selectionTool : doc.tool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              className={`${styles.chromeIcon} ${railActive ? styles.toolRailActive : ''}`}
              onClick={() => {
                if (tool.id === 'select' && selectionTool) {
                  setFlyoutOpen((open) => !open);
                  return;
                }
                if (doc.tool === tool.id) {
                  setFlyoutOpen((open) => !open);
                  return;
                }
                dispatch({ type: 'setTool', tool: tool.id });
              }}
              aria-label={`${tool.label}（${shortcut}）`}
              aria-pressed={railActive}
              aria-expanded={railActive ? flyoutOpen : undefined}
              title={`${TOOL_FLYOUT_TITLES[tool.id]}（${shortcut}）`}
            >
              <ToolGlyph id={tool.id} lasso={tool.id === 'select' && lassoSelect} />
            </button>
          );
        })}
        <hr className={styles.toolRailRule} />
        <button
          type="button"
          className={styles.chromeIcon}
          disabled={historyControlsDisabled(textEditing, history.past.length)}
          onClick={onUndo}
          aria-label={`取り消し（${shortcutLabelFromCode(shortcuts.undo)} / Ctrl+Z）`}
          title={`取り消し（${shortcutLabelFromCode(shortcuts.undo)} / Ctrl+Z）`}
        >
          <IconUndo />
        </button>
        <button
          type="button"
          className={styles.chromeIcon}
          disabled={historyControlsDisabled(textEditing, history.future.length)}
          onClick={onRedo}
          aria-label={`やり直し（${shortcutLabelFromCode(shortcuts.redo)} / Ctrl+Y）`}
          title={`やり直し（${shortcutLabelFromCode(shortcuts.redo)} / Ctrl+Y）`}
        >
          <IconRedo />
        </button>
      </div>

      {flyoutOpen ? (
      <aside
        className={styles.toolFlyout}
        aria-label={`${TOOL_FLYOUT_TITLES[doc.tool]}の設定`}
        {...{ [PAGE_TEXT_CHROME_ATTR]: '' }}
      >
        <h4 className={styles.toolFlyoutTitle}>{TOOL_FLYOUT_TITLES[doc.tool]}</h4>

        {doc.tool === 'scissors' ? (
          <>
          <div className={styles.toolFlyoutSection}>
            <div className={styles.penPresetLabel}>形</div>
            <div className={styles.selectFilterRow} role="group" aria-label="ハサミの形">
              <button
                type="button"
                className={`${styles.selectFilterButton} ${!scissorsLasso ? styles.toolButtonActive : ''}`}
                aria-pressed={!scissorsLasso}
                aria-label="矩形"
                onClick={() => dispatch({ type: 'setToolProperties', patch: { scissorsLasso: false } })}
              >
                矩形
              </button>
              <button
                type="button"
                className={`${styles.selectFilterButton} ${scissorsLasso ? styles.toolButtonActive : ''}`}
                aria-pressed={scissorsLasso}
                aria-label="投げ縄"
                onClick={() => dispatch({ type: 'setToolProperties', patch: { scissorsLasso: true } })}
              >
                投げ縄
              </button>
            </div>
            <p className={styles.toolFlyoutHint}>
              クリップを切って新しいクリップにします。PCでは Ctrl を押しながらドラッグすると投げ縄になります。
            </p>
          </div>
          <div className={styles.toolFlyoutSection}>
            <div className={styles.penPresetLabel}>対象</div>
            <div className={styles.selectFilterRow} role="group" aria-label="切り取り後の選択対象">
              {SCISSORS_FILTERS.map((filter) => {
                const on =
                  filter.key === 'scissorsSelectText'
                    ? scissorsTargets.text
                    : filter.key === 'scissorsSelectInk'
                      ? scissorsTargets.ink
                      : scissorsTargets.clip;
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
          </div>
          <div className={styles.toolFlyoutSection}>
            <div className={styles.selectFilterRow} role="group" aria-label="カット後のツール">
              <button
                type="button"
                className={`${styles.selectFilterButton} ${scissorsSwitchToSelect ? styles.toolButtonActive : ''}`}
                aria-pressed={scissorsSwitchToSelect}
                aria-label="カット後に選択ツールへ"
                onClick={() =>
                  dispatch({
                    type: 'setToolProperties',
                    patch: { scissorsSwitchToSelect: !scissorsSwitchToSelect },
                  })
                }
              >
                カット後に選択
              </button>
            </div>
          </div>
          </>
        ) : null}

        {selectionTool ? (
          <>
          <div className={styles.toolFlyoutSection}>
            <div className={styles.penPresetLabel}>形</div>
            <div className={styles.selectFilterRow} role="group" aria-label="選択の形">
              <button
                type="button"
                className={`${styles.selectFilterButton} ${!lassoSelect ? styles.toolButtonActive : ''}`}
                aria-pressed={!lassoSelect}
                aria-label="矩形"
                onClick={() => {
                  dispatch({ type: 'setTool', tool: 'select' });
                  dispatch({ type: 'setToolProperties', patch: { selectLasso: false } });
                }}
              >
                矩形
              </button>
              <button
                type="button"
                className={`${styles.selectFilterButton} ${lassoSelect ? styles.toolButtonActive : ''}`}
                aria-pressed={lassoSelect}
                aria-label="投げ縄"
                onClick={() => {
                  dispatch({ type: 'setTool', tool: 'select' });
                  dispatch({ type: 'setToolProperties', patch: { selectLasso: true } });
                }}
              >
                投げ縄
              </button>
            </div>
            {lassoSelect ? (
              <p className={styles.toolFlyoutHint}>囲んで選択・切り取ります。線画クリップは四角形になります。</p>
            ) : null}
          </div>
          <div className={styles.toolFlyoutSection}>
            <div className={styles.penPresetLabel}>対象</div>
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
          </div>
          {showSelectTextSize ? (
            <div className={styles.toolFlyoutSection}>
              {writingModeRow}
              <ValueSlider
                label="フォントサイズ"
                min={12}
                max={96}
                step={1}
                value={sizeValue}
                onChange={handleSizeChange}
              />
            </div>
          ) : null}
          </>
        ) : null}

        {doc.tool === 'pen' || doc.tool === 'eraser' ? (
          <PenSizePresetRow
            groupLabel={doc.tool === 'eraser' ? '消しゴム' : 'ペン'}
            sizePresets={doc.tool === 'eraser' ? appSettings.eraserSizePresets : appSettings.penSizePresets}
            opacityPresets={doc.tool === 'eraser' ? appSettings.eraserOpacityPresets : appSettings.penOpacityPresets}
            storedIndex={inkPresetIndex}
            sizeMax={doc.tool === 'eraser' ? ERASER_SIZE_MAX : PEN_SIZE_MAX}
            pressureSize={inkPressureSize}
            pressureOpacity={inkPressureOpacity}
            onSelect={(index) => {
              if (doc.tool === 'eraser') {
                const eraserSize = appSettings.eraserSizePresets[index]!;
                const eraserOpacity = appSettings.eraserOpacityPresets[index]!;
                updateAppSettings({ eraserSizePresetIndex: index });
                dispatch({
                  type: 'setToolProperties',
                  patch: {
                    eraserSize,
                    eraserOpacity,
                    eraserPressureAffectsSize: appSettings.eraserPressureSize[index]!,
                    eraserPressureAffectsOpacity: appSettings.eraserPressureOpacity[index]!,
                  },
                });
                showInkSizePreview('eraser', eraserSize, '#FFFFFF', eraserOpacity);
                return;
              }
              const sizeOn = appSettings.penPressureSize[index]!;
              const opacityOn = appSettings.penPressureOpacity[index]!;
              const penSize = appSettings.penSizePresets[index]!;
              const penOpacity = appSettings.penOpacityPresets[index]!;
              updateAppSettings({ penSizePresetIndex: index });
              dispatch({
                type: 'setToolProperties',
                patch: {
                  penSize,
                  penOpacity,
                  pressureAffectsSize: sizeOn,
                  pressureAffectsOpacity: opacityOn,
                  pressureEnabled: sizeOn || opacityOn,
                },
              });
              showInkSizePreview('pen', penSize, doc.tools.penColor, penOpacity);
            }}
            onChangeSize={(index, value) => {
              if (doc.tool === 'eraser') {
                updateAppSettings({
                  eraserSizePresets: patchPreset(appSettings.eraserSizePresets, index, value),
                  eraserSizePresetIndex: index,
                });
                dispatch({ type: 'setToolProperties', patch: { eraserSize: value } });
                showInkSizePreview('eraser', value, '#FFFFFF', doc.tools.eraserOpacity);
                return;
              }
              updateAppSettings({
                penSizePresets: patchPreset(appSettings.penSizePresets, index, value),
                penSizePresetIndex: index,
              });
              dispatch({ type: 'setToolProperties', patch: { penSize: value } });
              showInkSizePreview('pen', value, doc.tools.penColor, doc.tools.penOpacity);
            }}
            onChangeOpacity={(index, value) => {
              if (doc.tool === 'eraser') {
                updateAppSettings({
                  eraserOpacityPresets: patchPreset(appSettings.eraserOpacityPresets, index, value),
                  eraserSizePresetIndex: index,
                });
                dispatch({ type: 'setToolProperties', patch: { eraserOpacity: value } });
                return;
              }
              updateAppSettings({
                penOpacityPresets: patchPreset(appSettings.penOpacityPresets, index, value),
                penSizePresetIndex: index,
              });
              dispatch({ type: 'setToolProperties', patch: { penOpacity: value } });
            }}
            onChangePressure={(next) => {
              if (doc.tool === 'eraser') {
                updateAppSettings({
                  eraserPressureSize: patchBoolPreset(appSettings.eraserPressureSize, inkPresetIndex, next.size),
                  eraserPressureOpacity: patchBoolPreset(
                    appSettings.eraserPressureOpacity,
                    inkPresetIndex,
                    next.opacity,
                  ),
                });
                dispatch({
                  type: 'setToolProperties',
                  patch: {
                    eraserPressureAffectsSize: next.size,
                    eraserPressureAffectsOpacity: next.opacity,
                  },
                });
                return;
              }
              updateAppSettings({
                penPressureSize: patchBoolPreset(appSettings.penPressureSize, inkPresetIndex, next.size),
                penPressureOpacity: patchBoolPreset(appSettings.penPressureOpacity, inkPresetIndex, next.opacity),
              });
              dispatch({
                type: 'setToolProperties',
                patch: {
                  pressureAffectsSize: next.size,
                  pressureAffectsOpacity: next.opacity,
                  pressureEnabled: next.size || next.opacity,
                },
              });
            }}
          />
        ) : !selectionTool && showSize ? (
          <>
          {writingModeRow}
          <ValueSlider
            label="サイズ"
            min={12}
            max={96}
            step={1}
            value={sizeValue}
            onChange={handleSizeChange}
          />
          </>
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
      ) : null}
      </div>
      {trailing ? <div className={styles.leftChromeExtras}>{trailing}</div> : null}
    </div>
    </>
  );
}
