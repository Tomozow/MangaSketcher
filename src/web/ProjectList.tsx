'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  runStartupGc,
  type ProjectMeta,
} from '@/src/storage';
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
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleCreate = async () => {
    const pageCount = promptPageCount();
    if (pageCount === null) {
      return;
    }
    setError(null);
    setBusyId('__create__');
    try {
      const { meta } = await createProject(DEFAULT_PROJECT_NAME, pageCount);
      router.push(`/p/${meta.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロジェクトの作成に失敗しました。');
      setBusyId(null);
    }
  };

  const handleRename = async (project: ProjectMeta) => {
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

  const creating = busyId === '__create__';

  return (
    <>
      <section className={styles.list} style={{ touchAction: 'pan-y' }}>
        {loading ? (
          <p className={styles.empty}>読み込み中…</p>
        ) : projects.length === 0 ? (
          <>
            <p className={styles.empty}>保存済みプロジェクトはまだありません。</p>
            <p className={styles.hint}>「新規プロジェクト」で白紙のネームを作成できます。</p>
          </>
        ) : (
          <ul className={styles.projectRows}>
            {projects.map((project) => {
              const rowBusy = busyId === project.id;
              return (
                <li key={project.id} className={styles.projectRow}>
                  <Link href={`/p/${project.id}`} className={styles.projectOpen}>
                    <span className={styles.projectName}>{project.name}</span>
                    <span className={styles.projectMeta}>
                      {project.pageCount} ページ · {formatUpdatedAt(project.updatedAt)}
                    </span>
                  </Link>
                  <div className={styles.projectActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={rowBusy || creating}
                      onClick={() => void handleRename(project)}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      disabled={rowBusy || creating}
                      onClick={() => void handleDelete(project)}
                    >
                      削除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>
      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={loading || creating}
          onClick={() => void handleCreate()}
        >
          新規プロジェクト
        </button>
      </footer>
    </>
  );
}
