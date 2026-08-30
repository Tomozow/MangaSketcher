'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from './editorStyles';
import {
  canShareExportFile,
  EXPORT_DOWNLOAD_LABEL,
  EXPORT_FAILED_MESSAGE,
  EXPORT_PROGRESS_ELLIPSIS,
  EXPORT_SHARE_LABEL,
  formatExportProgress,
  revokeExportObjectUrl,
  shareExportFile,
  startExportDownload,
  WorkspaceExportAbortedError,
  type ExportProgress,
  type ObjectUrlTracker,
} from './export';
import { runClipExport, type ClipExportMode } from './export/runClipExport';
import type { ExportUiPhase } from './WorkspaceExportControls';

export const CLIP_EXPORT_ALL_LABEL = '.clip形式で保存';
export const CLIP_EXPORT_PAGE_LABEL = 'このページを.clipで保存';
export const CLIP_EXPORT_CANCEL_LABEL = 'キャンセル';

/** Combine PNG-zip and .clip export phases for the parent layout lock. */
export function mergeExportPhases(a: ExportUiPhase, b: ExportUiPhase): ExportUiPhase {
  if (a === 'generating' || b === 'generating') {
    return 'generating';
  }
  if (a === 'ready' || b === 'ready') {
    return 'ready';
  }
  if (a === 'failed' || b === 'failed') {
    return 'failed';
  }
  return 'idle';
}

type ClipExportControlsProps = {
  doc: EditorDocument;
  inkEngine: InkEngine | null;
  onPhaseChange?: (phase: ExportUiPhase) => void;
  onBeforeExport?: () => Promise<void>;
};

export function ClipExportControls({
  doc,
  inkEngine,
  onPhaseChange,
  onBeforeExport,
}: ClipExportControlsProps) {
  const [phase, setPhase] = useState<ExportUiPhase>('idle');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [canShare, setCanShare] = useState(false);
  const objectUrlRef = useRef<ObjectUrlTracker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const updatePhase = useCallback(
    (next: ExportUiPhase) => {
      setPhase(next);
      onPhaseChange?.(next);
    },
    [onPhaseChange],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      revokeExportObjectUrl(objectUrlRef.current, { unusedOnly: true });
      objectUrlRef.current = null;
    };
  }, []);

  const discardReady = useCallback(() => {
    revokeExportObjectUrl(objectUrlRef.current, { unusedOnly: true });
    objectUrlRef.current = null;
    setFile(null);
    setCanShare(false);
    setProgress(null);
  }, []);

  const handleExport = useCallback(
    async (mode: ClipExportMode) => {
      if (phase === 'generating') {
        return;
      }
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      discardReady();
      updatePhase('generating');

      if (!inkEngine) {
        updatePhase('failed');
        return;
      }

      try {
        const exported = await runClipExport({
          doc,
          inkEngine,
          mode,
          onBeforeExport,
          signal: abort.signal,
          onProgress: (next) => {
            if (mountedRef.current && !abort.signal.aborted) {
              setProgress(next);
            }
          },
        });
        if (abort.signal.aborted || !mountedRef.current) {
          return;
        }
        setFile(exported);
        setCanShare(canShareExportFile(exported));
        setProgress(null);
        updatePhase('ready');
      } catch (err) {
        if (!mountedRef.current || abort.signal.aborted || err instanceof WorkspaceExportAbortedError) {
          if (mountedRef.current && abort.signal.aborted) {
            setProgress(null);
            updatePhase('idle');
          }
          return;
        }
        setProgress(null);
        updatePhase('failed');
      }
    },
    [discardReady, doc, inkEngine, onBeforeExport, phase, updatePhase],
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    if (mountedRef.current) {
      setProgress(null);
      updatePhase('idle');
    }
  }, [updatePhase]);

  const handleShare = useCallback(async () => {
    if (!file) {
      return;
    }
    try {
      const result = await shareExportFile(file);
      if (result === 'aborted' || !mountedRef.current) {
        return;
      }
    } catch {
      if (!mountedRef.current) {
        return;
      }
      discardReady();
      updatePhase('failed');
    }
  }, [discardReady, file, updatePhase]);

  const handleDownload = useCallback(() => {
    if (!file) {
      return;
    }
    revokeExportObjectUrl(objectUrlRef.current, { unusedOnly: true });
    objectUrlRef.current = startExportDownload(file);
  }, [file]);

  const selectedPageInWorkspace =
    doc.selectedPageId != null && doc.workspaceOrder.includes(doc.selectedPageId);
  const busy = phase === 'generating';

  return (
    <>
      <div className={styles.clipExportButtons}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={CLIP_EXPORT_ALL_LABEL}
          disabled={busy || !inkEngine}
          onClick={() => {
            void handleExport('zip');
          }}
        >
          {CLIP_EXPORT_ALL_LABEL}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={CLIP_EXPORT_PAGE_LABEL}
          disabled={busy || !inkEngine || !selectedPageInWorkspace}
          onClick={() => {
            void handleExport('single');
          }}
        >
          {CLIP_EXPORT_PAGE_LABEL}
        </button>
      </div>
      {phase === 'generating' ? (
        <div className={styles.workspaceExportStatus} aria-live="polite">
          {progress
            ? formatExportProgress(progress.current, progress.total)
            : EXPORT_PROGRESS_ELLIPSIS}
          <div className={styles.workspaceExportActions}>
            <button type="button" className={styles.iconButton} onClick={handleCancel}>
              {CLIP_EXPORT_CANCEL_LABEL}
            </button>
          </div>
        </div>
      ) : null}
      {phase === 'ready' && file ? (
        <div className={styles.workspaceExportStatus}>
          <div className={styles.workspaceExportActions}>
            {canShare ? (
              <button type="button" className={styles.iconButton} onClick={() => void handleShare()}>
                {EXPORT_SHARE_LABEL}
              </button>
            ) : null}
            <button type="button" className={styles.iconButton} onClick={handleDownload}>
              {EXPORT_DOWNLOAD_LABEL}
            </button>
          </div>
        </div>
      ) : null}
      {phase === 'failed' ? (
        <div className={styles.workspaceExportStatus} role="alert">
          {EXPORT_FAILED_MESSAGE}
        </div>
      ) : null}
    </>
  );
}
