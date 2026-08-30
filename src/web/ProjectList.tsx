'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  runStartupGc,
  type ProjectMeta,
} from '@/src/storage';
import {
  AUTOSAVE_PRESET_OPTIONS,
  isAutosavePresetId,
  loadAppSettings,
  saveAppSettings,
  type AutosavePresetId,
} from '@/src/storage/appSettings';
import { projectHref } from '@/src/web/projectRoutes';
import { hardNavigate } from '@/src/web/hardNavigate';
import { HomeScreenInstallHint } from '@/src/web/HomeScreenInstallHint';
import { IconMoon, IconSun } from '@/src/web/chromeIcons';
import { useChromeTheme } from '@/src/web/useChromeTheme';
import styles from '@/app/page.module.css';

const DEFAULT_PROJECT_NAME = '無題';

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function promptPageCount(): number | null {
  const raw = window.prompt('ページ数を入力してください（1以上）', '1');
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value < 1 || String(value) !== trimmed) {
    window.alert('1以上の整数を入力してください。');
    return promptPageCount();
  }
  return value;
}

function promptRename(currentName: string): string | null {
  const raw = window.prompt('プロジェクト名', currentName);
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    window.alert('名前を入力してください。');
    return promptRename(currentName);
  }
  return trimmed;
}

export function ProjectList() {
  const { theme, toggleTheme } = useChromeTheme();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [autosavePreset, setAutosavePreset] = useState<AutosavePresetId>(
    () => loadAppSettings().autosavePreset,
  );

  const refresh = useCallback(async () => {
    setError(null);
    const items = await listProjects();
    setProjects(items);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await runStartupGc();
        const items = await listProjects();
        if (!cancelled) {
          setProjects(items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '一覧の読み込みに失敗しました。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuId) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-project-card-menu]')) {
        return;
      }
      setMenuId(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuId]);

  const handleCreate = async () => {
    const pageCount = promptPageCount();
    if (pageCount === null) {
      return;
    }
    setError(null);
    setBusyId('__create__');
    try {
      const { meta } = await createProject(DEFAULT_PROJECT_NAME, pageCount);
      hardNavigate(projectHref(meta.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロジェクトの作成に失敗しました。');
      setBusyId(null);
    }
  };

  const handleRename = async (project: ProjectMeta) => {
    setMenuId(null);
    const name = promptRename(project.name);
    if (name === null || name === project.name) {
      return;
    }
    setError(null);
    setBusyId(project.id);
    try {
      const meta = await renameProject(project.id, name);
      if (!meta) {
        setError('プロジェクトが見つかりませんでした。');
        await refresh();
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '名前の変更に失敗しました。');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (project: ProjectMeta) => {
    setMenuId(null);
    const confirmed = window.confirm(`「${project.name}」を削除しますか？`);
    if (!confirmed) {
      return;
    }
    setError(null);
    setBusyId(project.id);
    try {
      await deleteProject(project.id);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}（一覧に残っている場合は再度削除できます）`
          : '削除に失敗しました。一覧に残っている場合は再度削除できます。',
      );
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleAutosavePreset = (value: string) => {
    if (!isAutosavePresetId(value)) {
      return;
    }
    setAutosavePreset(saveAppSettings({ autosavePreset: value }).autosavePreset);
  };

  const creating = busyId === '__create__';
  const presetLabel =
    AUTOSAVE_PRESET_OPTIONS.find((preset) => preset.id === autosavePreset)?.label ?? autosavePreset;

  return (
    <div className={styles.home} data-ms-theme={theme}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden>
            MS
          </div>
          <div>
            <h1 className={styles.title}>MangaSketcher</h1>
            <span className={styles.subtitle}>端末内 · 自動保存</span>
          </div>
        </div>
        <div className={styles.tools}>
          <label className={styles.chip} htmlFor="autosave-preset">
            自動保存
            <select
              id="autosave-preset"
              className={styles.chipSelect}
              value={autosavePreset}
              onChange={(event) => handleAutosavePreset(event.target.value)}
              aria-label="自動保存の間隔"
            >
              {AUTOSAVE_PRESET_OPTIONS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={styles.themeButton}
            aria-label="明るい／暗いUI"
            title="明るい／暗いUI"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <button
            type="button"
            className={styles.newButton}
            disabled={loading || creating}
            onClick={() => void handleCreate()}
          >
            ＋ 新規ネーム
          </button>
        </div>
      </header>

      <HomeScreenInstallHint />

      <section className={styles.list} style={{ touchAction: 'pan-y' }} aria-label="プロジェクト">
        {loading ? (
          <p className={styles.empty}>読み込み中…</p>
        ) : (
          <div className={styles.grid}>
            {projects.map((project) => {
              const rowBusy = busyId === project.id;
              return (
                <article key={project.id} className={styles.card} data-project-card-menu>
                  <a href={projectHref(project.id)} className={styles.cardOpen}>
                    <div className={styles.cardThumb} aria-hidden>
                      <span className={styles.miniPage} />
                      {project.pageCount > 1 ? <span className={styles.miniPage} /> : null}
                    </div>
                    <div className={styles.cardMeta}>
                      <strong className={styles.projectName}>{project.name}</strong>
                      <small className={styles.projectMeta}>
                        {project.pageCount} ページ · {formatUpdatedAt(project.updatedAt)}
                      </small>
                    </div>
                  </a>
                  <button
                    type="button"
                    className={styles.cardMenuButton}
                    aria-label={`${project.name}のメニュー`}
                    aria-expanded={menuId === project.id}
                    disabled={rowBusy || creating}
                    onClick={() => setMenuId((current) => (current === project.id ? null : project.id))}
                  >
                    ⋯
                  </button>
                  {menuId === project.id ? (
                    <div className={styles.cardMenu} role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className={styles.secondaryButton}
                        disabled={rowBusy || creating}
                        onClick={() => void handleRename(project)}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={styles.dangerButton}
                        disabled={rowBusy || creating}
                        onClick={() => void handleDelete(project)}
                      >
                        削除
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
            <button
              type="button"
              className={`${styles.card} ${styles.cardNew}`}
              disabled={loading || creating}
              onClick={() => void handleCreate()}
            >
              ＋
              <span>新規プロジェクト</span>
            </button>
          </div>
        )}
        {projects.length === 0 && !loading ? (
          <p className={styles.hint}>「新規ネーム」で白紙のネームを作成できます。</p>
        ) : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>

      <p className={styles.settingsHint}>
        自動保存は {presetLabel}。間隔を長くすると描画中の保存負荷が下がります。タブを閉じる・バックグラウンドにするときはすぐ保存します。
      </p>
    </div>
  );
}
