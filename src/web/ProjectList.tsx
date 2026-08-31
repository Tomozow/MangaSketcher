'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  createProject,
  deleteProject,
  exportProjectPack,
  importProjectPack,
  listProjects,
  releaseDefaultStorageDatabase,
  renameProject,
  runStartupGc,
  type ProjectMeta,
} from '@/src/storage';
import { ProjectPackError } from '@/src/storage/projectPack';
import { projectHref } from '@/src/web/projectRoutes';
import { hardNavigate } from '@/src/web/hardNavigate';
import { IconMoon, IconSun } from '@/src/web/chromeIcons';
import { useChromeTheme } from '@/src/web/useChromeTheme';
import { ProjectListThumbs } from '@/src/web/ProjectListThumbs';
import {
  canShareExportFile,
  EXPORT_DOWNLOAD_LABEL,
  EXPORT_SHARE_LABEL,
  revokeExportObjectUrl,
  shareExportFile,
  startExportDownload,
  type ObjectUrlTracker,
} from '@/src/web/export';
import {
  getShellUpdateStatus,
  shellUpdateStatusLabel,
  subscribeShellUpdateStatus,
} from '@/src/web/shellUpdate';
import { useAppShellHeight } from '@/src/web/appShellHeight';
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
  const shellHeight = useAppShellHeight();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<ObjectUrlTracker | null>(null);
  const [shellStatus, setShellStatus] = useState(getShellUpdateStatus);
  const [exportGeneratingId, setExportGeneratingId] = useState<string | null>(null);
  const [pendingExport, setPendingExport] = useState<{
    projectId: string;
    projectName: string;
    file: File;
    canShare: boolean;
  } | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const items = await listProjects();
    setProjects(items);
  }, []);

  useEffect(() => {
    return () => {
      revokeExportObjectUrl(objectUrlRef.current, { unusedOnly: true });
      objectUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    setShellStatus(getShellUpdateStatus());
    return subscribeShellUpdateStatus(setShellStatus);
  }, []);

  const discardPendingExport = useCallback(() => {
    revokeExportObjectUrl(objectUrlRef.current, { unusedOnly: true });
    objectUrlRef.current = null;
    setPendingExport(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      releaseDefaultStorageDatabase();
      try {
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
      try {
        await runStartupGc();
        const items = await listProjects();
        if (!cancelled) {
          setProjects(items);
        }
      } catch {
        // GC must not keep the list spinning
      }
    };
    void load();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        cancelled = false;
        setLoading(true);
        void load();
      }
    };
    const onPageHide = () => {
      releaseDefaultStorageDatabase();
    };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
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

  const handleExport = async (project: ProjectMeta) => {
    if (exportGeneratingId || pendingExport) {
      return;
    }
    setMenuId(null);
    setError(null);
    discardPendingExport();
    setExportGeneratingId(project.id);
    try {
      const file = await exportProjectPack(project.id);
      setPendingExport({
        projectId: project.id,
        projectName: project.name,
        file,
        canShare: canShareExportFile(file),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エクスポートに失敗しました。');
    } finally {
      setExportGeneratingId(null);
    }
  };

  const handleExportShare = async () => {
    if (!pendingExport) {
      return;
    }
    try {
      const result = await shareExportFile(pendingExport.file);
      if (result === 'aborted') {
        return;
      }
    } catch {
      setError('エクスポートに失敗しました。');
      discardPendingExport();
    }
  };

  const handleExportDownload = () => {
    if (!pendingExport) {
      return;
    }
    revokeExportObjectUrl(objectUrlRef.current, { unusedOnly: true });
    objectUrlRef.current = startExportDownload(pendingExport.file);
  };

  const handleImportPick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setError(null);
    setBusyId('__import__');
    try {
      await importProjectPack(file);
      await refresh();
    } catch (err) {
      setError(
        err instanceof ProjectPackError || err instanceof Error
          ? err.message
          : 'インポートに失敗しました。',
      );
    } finally {
      setBusyId(null);
    }
  };

  const shellLabel = shellUpdateStatusLabel(shellStatus);
  const creating = busyId === '__create__';
  const importing = busyId === '__import__';
  const exportBusy = exportGeneratingId != null || pendingExport != null;
  const listBusy = creating || importing || exportBusy;

  return (
    <div
      className={styles.home}
      data-ms-theme={theme}
      data-ms-app-shell="home"
      style={shellHeight != null ? { minHeight: `${shellHeight}px` } : undefined}
    >
      <header className={styles.top}>
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden>
            MS
          </div>
          <div>
            <h1 className={styles.title}>MangaSketcher</h1>
            <span className={styles.subtitle}>端末内 · 自動保存</span>
            {shellLabel ? (
              <span className={styles.shellStatus} aria-live="polite">
                {shellLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div className={styles.tools}>
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
            className={styles.secondaryButton}
            disabled={loading || listBusy}
            onClick={handleImportPick}
          >
            インポート
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => void handleImportFile(event)}
          />
          <button
            type="button"
            className={styles.newButton}
            disabled={loading || listBusy}
            onClick={() => void handleCreate()}
          >
            ＋ 新規ネーム
          </button>
        </div>
      </header>

      <section className={styles.list} style={{ touchAction: 'pan-y' }} aria-label="プロジェクト">
        {loading ? (
          <p className={styles.empty}>読み込み中…</p>
        ) : (
          <div className={styles.grid}>
            {projects.map((project) => {
              const rowBusy = busyId === project.id || exportGeneratingId === project.id;
              return (
                <article key={project.id} className={styles.card} data-project-card-menu>
                  <a
                    href={projectHref(project.id)}
                    className={styles.cardOpen}
                    onClick={(event) => {
                      if (
                        event.defaultPrevented
                        || event.button !== 0
                        || event.metaKey
                        || event.ctrlKey
                        || event.shiftKey
                        || event.altKey
                      ) {
                        return;
                      }
                      event.preventDefault();
                      hardNavigate(projectHref(project.id));
                    }}
                  >
                    <div className={styles.cardThumb} aria-hidden>
                      <ProjectListThumbs projectId={project.id} pageCount={project.pageCount} />
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
                    disabled={rowBusy || listBusy}
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
                        disabled={rowBusy || listBusy}
                        onClick={() => void handleRename(project)}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={styles.secondaryButton}
                        disabled={rowBusy || listBusy}
                        onClick={() => void handleExport(project)}
                      >
                        エクスポート
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={styles.dangerButton}
                        disabled={rowBusy || listBusy}
                        onClick={() => void handleDelete(project)}
                      >
                        削除
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        {projects.length === 0 && !loading ? (
          <p className={styles.hint}>「新規ネーム」で白紙のネームを作成できます。</p>
        ) : null}
        {pendingExport ? (
          <div className={styles.exportReady} aria-live="polite">
            <span className={styles.exportReadyLabel}>
              「{pendingExport.projectName}」のエクスポート準備ができました
            </span>
            <div className={styles.exportReadyActions}>
              {pendingExport.canShare ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void handleExportShare()}
                >
                  {EXPORT_SHARE_LABEL}
                </button>
              ) : null}
              <button type="button" className={styles.secondaryButton} onClick={handleExportDownload}>
                {EXPORT_DOWNLOAD_LABEL}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={discardPendingExport}>
                キャンセル
              </button>
            </div>
          </div>
        ) : null}
        {exportGeneratingId ? (
          <p className={styles.hint}>エクスポートを準備しています…</p>
        ) : null}
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>

      <p className={styles.settingsHint}>
        自動保存の間隔は編集画面の設定から変えられます。タブを閉じる・バックグラウンドにするときはすぐ保存します。
      </p>
    </div>
  );
}
