'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AUTOSAVE_MS_MAX,
  AUTOSAVE_MS_MIN,
  DEFAULT_SHORTCUTS,
  HISTORY_DEPTH_MAX,
  HISTORY_DEPTH_MIN,
  INK_IDLE_MS_MAX,
  INK_IDLE_MS_MIN,
  SHORTCUT_ACTION_IDS,
  SHORTCUT_ACTION_LABELS,
  assignShortcut,
  isAssignableShortcutCode,
  shortcutLabelFromCode,
  type AppSettings,
  type ShortcutActionId,
} from '@/src/storage/appSettings';
import { IconSettings } from './chromeIcons';
import { styles } from './editorStyles';

type AppSettingsMenuProps = {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
};

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? `${seconds}秒` : `${seconds.toFixed(1)}秒`;
}

export function AppSettingsMenu({ settings, onChange }: AppSettingsMenuProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [capturing, setCapturing] = useState<ShortcutActionId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelOpen) {
      setCapturing(null);
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
  }, [panelOpen]);

  useEffect(() => {
    if (!capturing) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setCapturing(null);
        return;
      }
      if (!isAssignableShortcutCode(event.code)) {
        return;
      }
      onChange({ shortcuts: assignShortcut(settings.shortcuts, capturing, event.code) });
      setCapturing(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, onChange, settings.shortcuts]);

  return (
    <div ref={rootRef} className={styles.appSettingsMenu} data-ms-shell="app-settings">
      <button
        type="button"
        className={`${styles.chromeIcon} ${panelOpen ? styles.chromeIconPressed : ''}`}
        aria-label="設定"
        aria-expanded={panelOpen}
        title="設定"
        onClick={() => setPanelOpen((open) => !open)}
      >
        <IconSettings />
      </button>
      {panelOpen ? (
        <div className={styles.appSettingsPanel} role="dialog" aria-label="設定">
          <div className={styles.sliderBlock}>
            <label className={styles.sliderLabel}>
              ペン使用時の保存待機 {formatSeconds(settings.inkIdleMs)}
            </label>
            <input
              className={styles.sliderInput}
              type="range"
              min={INK_IDLE_MS_MIN}
              max={INK_IDLE_MS_MAX}
              step={100}
              value={settings.inkIdleMs}
              onChange={(event) => onChange({ inkIdleMs: Number(event.target.value) })}
            />
          </div>
          <div className={styles.sliderBlock}>
            <label className={styles.sliderLabel}>自動保存 {formatSeconds(settings.autosaveMs)}</label>
            <input
              className={styles.sliderInput}
              type="range"
              min={AUTOSAVE_MS_MIN}
              max={AUTOSAVE_MS_MAX}
              step={100}
              value={settings.autosaveMs}
              onChange={(event) => onChange({ autosaveMs: Number(event.target.value) })}
            />
          </div>
          <div className={styles.sliderBlock}>
            <label className={styles.sliderLabel}>取消履歴 {settings.historyDepth} 手</label>
            <input
              className={styles.sliderInput}
              type="range"
              min={HISTORY_DEPTH_MIN}
              max={HISTORY_DEPTH_MAX}
              step={10}
              value={settings.historyDepth}
              onChange={(event) => onChange({ historyDepth: Number(event.target.value) })}
            />
          </div>

          <label className={styles.workspaceLayoutCheck}>
            <input
              type="checkbox"
              checked={settings.navBarVisible}
              onChange={(event) => onChange({ navBarVisible: event.target.checked })}
            />
            ナビゲーションバーを表示
          </label>
          <label className={styles.workspaceLayoutCheck}>
            <input
              type="checkbox"
              checked={settings.chromeFlip}
              onChange={(event) => onChange({ chromeFlip: event.target.checked })}
            />
            サイドメニューとPDFの位置を入れ替える
          </label>
          <label className={styles.workspaceLayoutCheck}>
            <input
              type="checkbox"
              checked={settings.swapTopbarAndStock}
              onChange={(event) => onChange({ swapTopbarAndStock: event.target.checked })}
            />
            トップメニューとストックウィンドウの位置を入れ替える
          </label>
          <label className={styles.workspaceLayoutCheck}>
            <input
              type="checkbox"
              checked={settings.stockPdfButtonsOnPalette}
              onChange={(event) => onChange({ stockPdfButtonsOnPalette: event.target.checked })}
            />
            ツールパレットの下にストックとPDFボタンを置く
          </label>

          <label className={styles.workspaceLayoutCheck}>
            <input
              type="checkbox"
              checked={settings.toolFlyoutOnFirstTap}
              onChange={(event) => onChange({ toolFlyoutOnFirstTap: event.target.checked })}
            />
            ツール切替の1タップ目でオプションを表示
          </label>

          <div className={styles.workspaceLayoutCheckGroup}>
            <label className={styles.workspaceLayoutCheck}>
              <input
                type="checkbox"
                checked={settings.stockRevealOnBottomEdge}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  onChange(
                    enabled
                      ? { stockRevealOnBottomEdge: true }
                      : { stockRevealOnBottomEdge: false, stockHideAfterEdgeDrop: false },
                  );
                }}
              />
              アイテムを下端にドラッグしたときだけストックを表示
            </label>
            <label className={`${styles.workspaceLayoutCheck} ${styles.workspaceLayoutCheckNested}`}>
              <input
                type="checkbox"
                checked={settings.stockRevealOnBottomEdge && settings.stockHideAfterEdgeDrop}
                disabled={!settings.stockRevealOnBottomEdge}
                onChange={(event) => onChange({ stockHideAfterEdgeDrop: event.target.checked })}
              />
              ドロップ後に自動で隠す
            </label>
          </div>

          <fieldset className={styles.appSettingsFieldset}>
            <legend>ページ送りの単位</legend>
            <label className={styles.workspaceLayoutCheck}>
              <input
                type="radio"
                name="page-turn-unit"
                checked={settings.pageTurnUnit === 'page'}
                onChange={() => onChange({ pageTurnUnit: 'page' })}
              />
              単ページ
            </label>
            <label className={styles.workspaceLayoutCheck}>
              <input
                type="radio"
                name="page-turn-unit"
                checked={settings.pageTurnUnit === 'spread'}
                onChange={() => onChange({ pageTurnUnit: 'spread' })}
              />
              見開き
            </label>
          </fieldset>

          <section className={styles.appSettingsSection}>
            <h3 className={styles.appSettingsHeading}>ショートカット</h3>
            {SHORTCUT_ACTION_IDS.map((action) => (
              <button
                key={action}
                type="button"
                className={styles.appSettingsShortcutRow}
                aria-label={`${SHORTCUT_ACTION_LABELS[action]}のショートカットを変更`}
                onClick={() => setCapturing(action)}
              >
                <span>{SHORTCUT_ACTION_LABELS[action]}</span>
                <kbd className={capturing === action ? styles.appSettingsShortcutListening : undefined}>
                  {capturing === action ? 'キーを押す' : shortcutLabelFromCode(settings.shortcuts[action])}
                </kbd>
              </button>
            ))}
            <button
              type="button"
              className={styles.appSettingsReset}
              onClick={() => onChange({ shortcuts: { ...DEFAULT_SHORTCUTS } })}
            >
              ショートカットを初期値に戻す
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
