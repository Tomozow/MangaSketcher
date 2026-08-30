'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { exportProjectPack } from '@/src/storage';
import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from './editorStyles';
import { IconExport } from './chromeIcons';
import {
  canShareExportFile,
  EXPORT_BUTTON_LABEL,
  EXPORT_DOWNLOAD_LABEL,
  EXPORT_FAILED_MESSAGE,
  EXPORT_PROGRESS_ELLIPSIS,
  EXPORT_SHARE_LABEL,
  PROJECT_PACK_EXPORT_LABEL,
  formatExportProgress,
  revokeExportObjectUrl,
  shareExportFile,
  startExportDownload,
  WorkspaceExportAbortedError,
  type ExportProgress,
  type ObjectUrlTracker,
} from './export';
import { runExportGeneration } from './export/runExportGeneration';
import { ClipExportControls, mergeExportPhases } from './ClipExportControls';

export type ExportUiPhase = 'idle' | 'generating' | 'ready' | 'failed';

type WorkspaceExportControlsProps = {
  doc: EditorDocument;
  inkEngine: InkEngine | null;
  onPhaseChange?: (phase: ExportUiPhase) => void;
  onBeforeExport?: () => Promise<void>;
};

export function WorkspaceExportControls({
  doc,
  inkEngine,
  onPhaseChange,
  onBeforeExport,
}: WorkspaceExportControlsProps) {
  const [phase, setPhase] = useState<ExportUiPhase>('idle');
  const [clipPhase, setClipPhase] = useState<ExportUiPhase>('idle');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clipHost, setClipHost] = useState<HTMLElement | null>(null);
  const objectUrlRef = useRef<ObjectUrlTracker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const updatePhase = useCallback((next: ExportUiPhase) => {
    setPhase(next);
  }, []);

  useEffect(() => {
    onPhaseChange?.(mergeExportPhases(phase, clipPhase));
  }, [phase, clipPhase, onPhaseChange]);

  useEffect(() => {
    if (phase !== 'idle' || clipPhase !== 'idle') {
      setMenuOpen(false);
    }
  }, [phase, clipPhase]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

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
      const exported = await runExportGeneration({
        doc,
        inkEngine,
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
          updatePhase('idle');
        }
        return;
      }
      setProgress(null);
      updatePhase('failed');
    }
  }, [discardReady, doc, inkEngine, onBeforeExport, phase, updatePhase]);

  const handlePackExport = useCallback(async () => {
    if (phase === 'generating') {
      return;
    }
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    discardReady();
    updatePhase('generating');

    try {
      if (onBeforeExport) {
        await onBeforeExport();
      }
      if (abort.signal.aborted || !mountedRef.current) {
        return;
      }
      const exported = await exportProjectPack(doc.projectId, {
        requestExportCheckpoint: async () => {},
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
  }, [discardReady, doc.projectId, onBeforeExport, phase, updatePhase]);

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
    <div ref={rootRef} className={styles.workspaceExportControls}>
      <button
        type="button"
        className={`${styles.chromeIcon} ${phase === 'generating' || menuOpen ? styles.chromeIconPressed : ''}`}
        aria-label={EXPORT_BUTTON_LABEL}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        title={EXPORT_BUTTON_LABEL}
        disabled={phase === 'generating'}
        onClick={() => {
          setMenuOpen((open) => !open);
        }}
      >
        <IconExport />
      </button>
      <div
        className={`${styles.exportMenu} ${menuOpen && phase === 'idle' && clipPhase === 'idle' ? '' : styles.isHidden}`}
        role="menu"
        aria-label="書き出し"
        hidden={!(menuOpen && phase === 'idle' && clipPhase === 'idle')}
      >
          <button
            type="button"
            role="menuitem"
            className={styles.exportMenuItem}
            onClick={() => {
              setMenuOpen(false);
              void handleExport();
            }}
          >
            {EXPORT_BUTTON_LABEL}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.exportMenuItem}
            onClick={() => {
              setMenuOpen(false);
              void handlePackExport();
            }}
          >
            {PROJECT_PACK_EXPORT_LABEL}
          </button>
          <div ref={setClipHost} />
      </div>
      <ClipExportControls
        doc={doc}
        inkEngine={inkEngine}
        onPhaseChange={setClipPhase}
        onBeforeExport={onBeforeExport}
        triggerHost={clipHost}
        itemClassName={styles.exportMenuItem}
        onPick={() => setMenuOpen(false)}
      />
      {phase === 'generating' ? (
        <div className={styles.workspaceExportStatus} aria-live="polite">
          {progress ? formatExportProgress(progress.current, progress.total) : EXPORT_PROGRESS_ELLIPSIS}
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
