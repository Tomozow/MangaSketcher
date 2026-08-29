'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from './editorStyles';
import {
  canShareExportFile,
  EXPORT_BUTTON_LABEL,
  EXPORT_DOWNLOAD_LABEL,
  EXPORT_FAILED_MESSAGE,
  EXPORT_SHARE_LABEL,
  exportWorkspace,
  formatExportProgress,
  revokeExportObjectUrl,
  shareExportFile,
  startExportDownload,
  WorkspaceExportAbortedError,
  type ExportProgress,
  type ObjectUrlTracker,
} from './export';

export type ExportUiPhase = 'idle' | 'generating' | 'ready' | 'failed';

type WorkspaceExportControlsProps = {
  doc: EditorDocument;
  inkEngine: InkEngine | null;
  onPhaseChange?: (phase: ExportUiPhase) => void;
};

export function WorkspaceExportControls({
  doc,
  inkEngine,
  onPhaseChange,
}: WorkspaceExportControlsProps) {
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

  const handleExport = useCallback(async () => {
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
      const exported = await exportWorkspace(doc, inkEngine, {
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
          updatePhase('idle');
        }
        return;
      }
      setProgress(null);
      updatePhase('failed');
    }
  }, [discardReady, doc, inkEngine, phase, updatePhase]);

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

  return (
    <div className={styles.workspaceExportControls}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={EXPORT_BUTTON_LABEL}
        disabled={phase === 'generating'}
        onClick={() => {
          void handleExport();
        }}
      >
        {EXPORT_BUTTON_LABEL}
      </button>
      {phase === 'generating' && progress ? (
        <div className={styles.workspaceExportStatus} aria-live="polite">
          {formatExportProgress(progress.current, progress.total)}
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
    </div>
  );
}
