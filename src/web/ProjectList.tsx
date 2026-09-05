'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  createProject,
  deleteProject,
  duplicateProject,
  exportProjectPack,
  importProjectPack,
  listProjects,
  releaseDefaultStorageDatabase,
  renameProject,
  runStartupGc,
  type ProjectImportProgress,
  type ProjectMeta,
} from '@/src/storage';
import { ProjectPackError } from '@/src/storage/projectPack';
import { projectHref } from '@/src/web/projectRoutes';
import { hardNavigate } from '@/src/web/hardNavigate';
import { IconMoon, IconSun } from '@/src/web/chromeIcons';
import { useChromeTheme } from '@/src/web/useChromeTheme';
import { ProjectListThumbs } from '@/src/web/ProjectListThumbs';
import {
  EXPORT_DOWNLOAD_LABEL,
  revokeExportObjectUrl,
  startExportDownload,
  type ObjectUrlTracker,
} from '@/src/web/export';
import {
  getShellUpdateStatus,
  shellUpdateStatusLabel,
  subscribeShellUpdateStatus,
} from '@/src/web/shellUpdate';
import { useAppShellHeight } from '@/src/web/appShellHeight';
import { prepareImportedProjectOffThread } from '@/src/web/projectImport/prepareImportedProjectOffThread';
import { IpadCaQrButton } from '@/src/web/IpadCaQrButton';
import {
  LanTransferControls,
  type LanTransferControlsHandle,
} from '@/src/web/LanTransferControls';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';
import styles from '@/app/page.module.css';

const DEFAULT_PROJECT_NAME = '無題';

function importProgressLabel(progress: ProjectImportProgress): string {
  switch (progress.phase) {
    case 'reading':
      return 'ファイルを読み込んでいます…';
    case 'unzip':
      return 'パックを展開しています…';
    case 'normalize':
      if (progress.total && progress.current) {
        return `画像を変換しています…（${progress.current}/${progress.total}）`;
      }
      return '画像を変換しています…';
    case 'saving':
      return '保存しています…';
  }
}

function importProgressRatio(progress: ProjectImportProgress): number {
  switch (progress.phase) {
    case 'reading':
      return 0.08;
    case 'unzip':
      return 0.22;
    case 'normalize':
      if (progress.total && progress.total > 0 && progress.current) {
        return 0.22 + 0.68 * (progress.current / progress.total);
      }
      return 0.45;
    case 'saving':
      return 0.96;
  }
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
      return;
    }
    setTimeout(resolve, 0);
  });
}

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
  const [importProgress, setImportProgress] = useState<ProjectImportProgress | null>(null);
  const [pendingExport, setPendingExport] = useState<{
    projectId: string;
    projectName: string;
    file: File;
  } | null>(null);
  const [lanBusy, setLanBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lanTransferRef = useRef<LanTransferControlsHandle | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setNotice(null);
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
        // #region agent log
        ipadDebugLog({
          sessionId: 'adcc47',
          ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
          hypothesisId: 'A',
          location: 'ProjectList.tsx:load',
          message: 'listProjects ok',
          data: { count: items.length, cancelled },
        });
        // #endregion
        if (!cancelled) {
          setProjects(items);
        }
      } catch (err) {
        // #region agent log
        ipadDebugLog({
          sessionId: 'adcc47',
          ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
          hypothesisId: 'A',
          location: 'ProjectList.tsx:load',
          message: 'listProjects failed',
          data: {
            name: err instanceof Error ? err.name : 'unknown',
            msg: err instanceof Error ? err.message : String(err),
            cancelled,
          },
        });
        // #endregion
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
      } catch (err) {
        // #region agent log
        ipadDebugLog({
          sessionId: 'adcc47',
          ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
          hypothesisId: 'E',
          location: 'ProjectList.tsx:gc',
          message: 'runStartupGc or second list failed',
          data: {
            name: err instanceof Error ? err.name : 'unknown',
            msg: err instanceof Error ? err.message : String(err),
          },
        });
        // #endregion
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
    const onWinError = (event: ErrorEvent) => {
      // #region agent log
      ipadDebugLog({
        sessionId: 'adcc47',
        ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
        hypothesisId: 'D',
        location: 'ProjectList.tsx:window.error',
        message: 'window error',
        data: { msg: event.message, filename: event.filename, lineno: event.lineno },
      });
      // #endregion
    };
    const onReject = (event: PromiseRejectionEvent) => {
      // #region agent log
      const reason = event.reason;
      ipadDebugLog({
        sessionId: 'adcc47',
        ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
        hypothesisId: 'D',
        location: 'ProjectList.tsx:unhandledrejection',
        message: 'unhandledrejection',
        data: {
          name: reason instanceof Error ? reason.name : typeof reason,
          msg: reason instanceof Error ? reason.message : String(reason),
        },
      });
      // #endregion
    };
    window.addEventListener('error', onWinError);
    window.addEventListener('unhandledrejection', onReject);
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('error', onWinError);
      window.removeEventListener('unhandledrejection', onReject);
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

  const handleDuplicate = async (project: ProjectMeta) => {
    setMenuId(null);
    setError(null);
    setBusyId(project.id);
    try {
      await duplicateProject(project.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロジェクトの複製に失敗しました。');
    } finally {
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
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エクスポートに失敗しました。');
    } finally {
      setExportGeneratingId(null);
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
    setImportProgress({ phase: 'reading' });
    await waitForPaint();
    try {
      await importProjectPack(file, {
        onImportProgress: setImportProgress,
        prepareImported: (zipBytes, newProjectId, onProgress) =>
          prepareImportedProjectOffThread(
            zipBytes.slice().buffer as ArrayBuffer,
            newProjectId,
            onProgress,
          ),
      });
      await refresh();
    } catch (err) {
      setError(
        err instanceof ProjectPackError || err instanceof Error
          ? err.message
          : 'インポートに失敗しました。',
      );
    } finally {
      setBusyId(null);
      setImportProgress(null);
    }
  };

  const shellLabel = shellUpdateStatusLabel(shellStatus);
  const creating = busyId === '__create__';
  const importing = busyId === '__import__';
  const exportBusy = exportGeneratingId != null || pendingExport != null;
  const listBusy = creating || importing || exportBusy || lanBusy;

  return (
    <div
      className={styles.home}
      data-ms-theme={theme}
      data-ms-app-shell="home"
      style={shellHeight != null ? { minHeight: `${shellHeight}px` } : undefined}
    >
      <header className={styles.top}>
        <div className={styles.brandCluster}>
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
          <LanTransferControls
            ref={lanTransferRef}
            listBusy={loading || creating || importing || exportBusy}
            importProgress={importProgress}
            setImportProgress={setImportProgress}
            onImported={refresh}
            setError={setError}
            setNotice={setNotice}
            onBusyChange={setLanBusy}
          />
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
            {importing ? 'インポート中…' : 'インポート'}
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

      {notice ? <p className={styles.hint}>{notice}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.list} style={{ touchAction: 'pan-y' }} aria-label="プロジェクト">
        {loading ? (
          <p className={styles.empty}>読み込み中…</p>
        ) : (
          <div className={styles.grid}>
            {importProgress ? (
              <article className={styles.card} aria-live="polite" aria-busy="true">
                <div className={styles.cardOpen}>
                  <div className={styles.cardThumb} aria-hidden>
                    <span className={styles.miniPage} />
                    <span className={styles.miniPage} />
                    <span className={styles.importTrack}>
                      <span
                        className={styles.importFill}
                        style={{ width: `${Math.round(importProgressRatio(importProgress) * 100)}%` }}
                      />
                    </span>
                  </div>
                  <div className={styles.cardMeta}>
                    <strong className={styles.projectName}>インポート中</strong>
                    <small className={styles.projectMeta}>{importProgressLabel(importProgress)}</small>
                  </div>
                </div>
              </article>
            ) : null}
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
                      <ProjectListThumbs
                        projectId={project.id}
                        pageCount={project.pageCount}
                        updatedAt={project.updatedAt}
                      />
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
                        onClick={() => void handleDuplicate(project)}
                      >
                        複製
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
                        className={styles.secondaryButton}
                        disabled={rowBusy || listBusy}
                        onClick={() => {
                          setMenuId(null);
                          void lanTransferRef.current?.startSend(project);
                        }}
                      >
                        LANで送る
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
      </section>
      <IpadCaQrButton />
    </div>
  );
}
