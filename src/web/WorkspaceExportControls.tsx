'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportProjectPack } from '@/src/storage';
import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from './editorStyles';
import { IconExport } from './chromeIcons';
import {
  canShareExportFile,
  EXPORT_BUTTON_LABEL,
  EXPORT_CANCEL_LABEL,
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
import {
  EXPORT_BACK_LABEL,
  EXPORT_CONFIRM_LABEL,
  EXPORT_FORMAT_IDS,
  EXPORT_FORMAT_LABELS,
  EXPORT_PAGES_DIALOG_LABEL,
  EXPORT_RANGE_END_LABEL,
  EXPORT_RANGE_START_LABEL,
  PAGE_SCOPE_LABELS,
  PAGE_SCOPE_MODES,
  formatExportPageCount,
  formatSkipsPagePicker,
  type ExportFormatId,
  type PageScopeMode,
} from './export/exportFormat';
import { getLastExportFormat, setLastExportFormat } from './export/lastExportFormat';
import { currentWorkspaceNumber, selectExportPages, sanitizeRangeInput } from './export/selectExportPages';
import { runClipExport } from './export/runClipExport';
import { runExportGeneration } from './export/runExportGeneration';
import { exportWorkspacePdf } from './export/exportWorkspacePdf';
import { exportWorkspaceMiniJpg } from './export/exportWorkspaceMiniJpg';

export type ExportUiPhase = 'idle' | 'generating' | 'ready' | 'failed';

type PanelView = 'formats' | 'pages';

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
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>('formats');
  const [highlightedFormat, setHighlightedFormat] = useState<ExportFormatId>(() =>
    getLastExportFormat(doc.projectId),
  );
  const [pendingFormat, setPendingFormat] = useState<Exclude<ExportFormatId, 'pack' | 'miniJpg'> | null>(
    null,
  );
  const [pageMode, setPageMode] = useState<PageScopeMode>('all');
  const [rangeStart, setRangeStart] = useState('1');
  const [rangeEnd, setRangeEnd] = useState('1');
  const objectUrlRef = useRef<ObjectUrlTracker | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const updatePhase = useCallback((next: ExportUiPhase) => {
    setPhase(next);
  }, []);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  useEffect(() => {
    if (phase !== 'idle') {
      setMenuOpen(false);
    }
  }, [phase]);

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

  useEffect(() => {
    setHighlightedFormat(getLastExportFormat(doc.projectId));
  }, [doc.projectId]);

  const discardReady = useCallback(() => {
    revokeExportObjectUrl(objectUrlRef.current, { unusedOnly: true });
    objectUrlRef.current = null;
    setFile(null);
    setCanShare(false);
    setProgress(null);
  }, []);

  const selection = useMemo(
    () =>
      selectExportPages({
        workspaceOrder: doc.workspaceOrder,
        selectedPageId: doc.selectedPageId,
        mode: pageMode,
        rangeStartRaw: rangeStart,
        rangeEndRaw: rangeEnd,
      }),
    [doc.selectedPageId, doc.workspaceOrder, pageMode, rangeEnd, rangeStart],
  );

  const finishFile = useCallback(
    (exported: File) => {
      if (abortRef.current?.signal.aborted || !mountedRef.current) {
        return;
      }
      setFile(exported);
      setCanShare(canShareExportFile(exported));
      setProgress(null);
      updatePhase('ready');
    },
    [updatePhase],
  );

  const runGeneration = useCallback(
    async (format: ExportFormatId, pageIds: EditorDocument['workspaceOrder'] | undefined, pick: PageScopeMode) => {
      if (phase === 'generating') {
        return;
      }
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      discardReady();
      setMenuOpen(false);
      updatePhase('generating');
      setLastExportFormat(doc.projectId, format);

      if (format !== 'pack' && !inkEngine) {
        updatePhase('failed');
        return;
      }

      try {
        if (format === 'pack') {
          if (onBeforeExport) {
            await onBeforeExport();
          }
          if (abort.signal.aborted || !mountedRef.current) {
            return;
          }
          const exported = await exportProjectPack(doc.projectId, {
            requestExportCheckpoint: async () => {},
          });
          finishFile(exported);
          return;
        }
        if (!inkEngine) {
          updatePhase('failed');
          return;
        }
        const onProgress = (next: ExportProgress) => {
          if (mountedRef.current && !abort.signal.aborted) {
            setProgress(next);
          }
        };
        if (format === 'png') {
          const exported = await runExportGeneration({
            doc,
            inkEngine,
            onBeforeExport,
            signal: abort.signal,
            onProgress,
            pageIds,
            pick,
          });
          finishFile(exported);
          return;
        }
        if (format === 'pdf') {
          if (onBeforeExport) {
            await onBeforeExport();
          }
          const exported = await exportWorkspacePdf(doc, inkEngine, {
            signal: abort.signal,
            onProgress,
            pageIds,
            pick,
          });
          finishFile(exported);
          return;
        }
        if (format === 'miniJpg') {
          if (onBeforeExport) {
            await onBeforeExport();
          }
          const exported = await exportWorkspaceMiniJpg(doc, inkEngine, {
            signal: abort.signal,
            onProgress,
          });
          finishFile(exported);
          return;
        }
        const exported = await runClipExport({
          doc,
          inkEngine,
          mode: (pageIds?.length ?? 0) === 1 ? 'single' : 'zip',
          pageIds,
          pick,
          onBeforeExport,
          signal: abort.signal,
          onProgress,
        });
        finishFile(exported);
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
    },
    [discardReady, doc, finishFile, inkEngine, onBeforeExport, phase, updatePhase],
  );

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

  const openPanel = () => {
    if (phase === 'generating') {
      return;
    }
    if (phase === 'ready') {
      discardReady();
      updatePhase('idle');
    }
    setHighlightedFormat(getLastExportFormat(doc.projectId));
    setPanelView('formats');
    setPendingFormat(null);
    setPageMode('all');
    setMenuOpen((open) => !open);
  };

  const chooseFormat = (format: ExportFormatId) => {
    setHighlightedFormat(format);
    if (formatSkipsPagePicker(format)) {
      void runGeneration(format, undefined, 'all');
      return;
    }
    const now = currentWorkspaceNumber(doc.workspaceOrder, doc.selectedPageId);
    const initial = String(now ?? 1);
    setRangeStart(initial);
    setRangeEnd(initial);
    setPageMode('all');
    setPendingFormat(format);
    setPanelView('pages');
  };

  const choosePageMode = (mode: PageScopeMode) => {
    if (mode === 'range') {
      const now = currentWorkspaceNumber(doc.workspaceOrder, doc.selectedPageId);
      const initial = String(now ?? 1);
      setRangeStart(initial);
      setRangeEnd(initial);
    }
    setPageMode(mode);
  };

  return (
    <div ref={rootRef} className={styles.workspaceExportControls}>
      <button
        type="button"
        className={`${styles.chromeIcon} ${phase === 'generating' || menuOpen ? styles.chromeIconPressed : ''}`}
        aria-label={EXPORT_BUTTON_LABEL}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        title={EXPORT_BUTTON_LABEL}
        disabled={phase === 'generating'}
        onClick={openPanel}
      >
        <IconExport />
      </button>
      <div
        className={`${styles.exportMenu} ${menuOpen && phase === 'idle' ? '' : styles.isHidden}`}
        role="dialog"
        aria-label={panelView === 'formats' ? EXPORT_BUTTON_LABEL : EXPORT_PAGES_DIALOG_LABEL}
        hidden={!(menuOpen && phase === 'idle')}
      >
        {panelView === 'formats'
          ? EXPORT_FORMAT_IDS.map((format) => (
              <button
                key={format}
                type="button"
                className={`${styles.exportMenuItem} ${highlightedFormat === format ? styles.chromeIconPressed : ''}`}
                aria-pressed={highlightedFormat === format}
                onClick={() => chooseFormat(format)}
              >
                {EXPORT_FORMAT_LABELS[format]}
              </button>
            ))
          : (
              <>
                {PAGE_SCOPE_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`${styles.exportMenuItem} ${pageMode === mode ? styles.chromeIconPressed : ''}`}
                    aria-pressed={pageMode === mode}
                    disabled={mode === 'current' && selection.currentDisabled}
                    onClick={() => choosePageMode(mode)}
                  >
                    {PAGE_SCOPE_LABELS[mode]}
                  </button>
                ))}
                {pageMode === 'range' ? (
                  <div className={styles.exportRangeRow}>
                    <label>
                      {EXPORT_RANGE_START_LABEL}
                      <input
                        inputMode="numeric"
                        value={rangeStart}
                        onChange={(event) => setRangeStart(sanitizeRangeInput(event.target.value))}
                      />
                    </label>
                    <label>
                      {EXPORT_RANGE_END_LABEL}
                      <input
                        inputMode="numeric"
                        value={rangeEnd}
                        onChange={(event) => setRangeEnd(sanitizeRangeInput(event.target.value))}
                      />
                    </label>
                  </div>
                ) : null}
                <div className={styles.exportPageCount}>{formatExportPageCount(selection.count)}</div>
                <button
                  type="button"
                  className={styles.exportMenuItem}
                  disabled={!selection.canExport || !pendingFormat}
                  onClick={() => {
                    if (!pendingFormat) {
                      return;
                    }
                    void runGeneration(pendingFormat, selection.pageIds, pageMode);
                  }}
                >
                  {EXPORT_CONFIRM_LABEL}
                </button>
                <button
                  type="button"
                  className={styles.exportMenuItem}
                  onClick={() => {
                    setPanelView('formats');
                    setPendingFormat(null);
                    setPageMode('all');
                  }}
                >
                  {EXPORT_BACK_LABEL}
                </button>
              </>
            )}
      </div>
      {phase === 'generating' ? (
        <div className={styles.workspaceExportStatus} aria-live="polite">
          {progress ? formatExportProgress(progress.current, progress.total) : EXPORT_PROGRESS_ELLIPSIS}
          <div className={styles.workspaceExportActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => {
                abortRef.current?.abort();
                setProgress(null);
                updatePhase('idle');
              }}
            >
              {EXPORT_CANCEL_LABEL}
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
    </div>
  );
}
