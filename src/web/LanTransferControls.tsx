'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  exportProjectPack,
  importProjectPack,
  type ProjectImportProgress,
  type ProjectMeta,
} from '@/src/storage';
import { ProjectPackError } from '@/src/storage/projectPack';
import { prepareImportedProjectOffThread } from '@/src/web/projectImport/prepareImportedProjectOffThread';
import {
  getLanPackZip,
  logLanPack,
  mintLanPackCode,
  probeLanPackHub,
  putLanPackZip,
} from '@/src/web/lanPack/client';
import {
  LAN_PACK_BAD_CODE,
  LAN_PACK_HUB_DOWN_MESSAGE,
  LAN_PACK_PDF_NOTICE,
  LAN_PACK_SENT,
  LAN_PACK_TOO_LARGE,
  isLanPackCode,
  normalizeLanPackDigits,
  resolveLanPackHubBase,
} from '@/src/web/lanPack/hubUrl';
import styles from '@/app/page.module.css';

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

function hubBaseFromWindow(): string | null {
  return resolveLanPackHubBase({
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    port: window.location.port,
  });
}

type Props = {
  listBusy: boolean;
  importProgress: ProjectImportProgress | null;
  setImportProgress: (progress: ProjectImportProgress | null) => void;
  onImported: () => Promise<void>;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  onBusyChange: (busy: boolean) => void;
};

export type LanTransferControlsHandle = {
  startSend: (project: ProjectMeta) => void;
};

export const LanTransferControls = forwardRef<LanTransferControlsHandle, Props>(
  function LanTransferControls(
    {
      listBusy,
      setImportProgress,
      onImported,
      setError,
      setNotice,
      onBusyChange,
    },
    ref,
  ) {
    const [mode, setMode] = useState<'idle' | 'send-code'>('idle');
    const [busy, setBusy] = useState(false);
    const [codeInput, setCodeInput] = useState('');
    const [sendProjectId, setSendProjectId] = useState<string | null>(null);
    const [sendProjectName, setSendProjectName] = useState<string | null>(null);
    const [recvCode, setRecvCode] = useState<string | null>(null);
    const [hubDown, setHubDown] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [sendPhase, setSendPhase] = useState<'form' | 'sending'>('form');
    const composingRef = useRef(false);
    const sendAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
      onBusyChange(busy || mode === 'send-code');
    }, [busy, mode, onBusyChange]);

    const closeSend = useCallback(() => {
      sendAbortRef.current?.abort();
      sendAbortRef.current = null;
      setMode('idle');
      setBusy(false);
      setCodeInput('');
      setSendProjectId(null);
      setSendProjectName(null);
      setStatus(null);
      setSendPhase('form');
    }, []);

    const requireHub = useCallback(async (): Promise<string | null> => {
      const hubBase = hubBaseFromWindow();
      if (hubBase == null) {
        setError(LAN_PACK_HUB_DOWN_MESSAGE);
        return null;
      }
      const ok = await probeLanPackHub(hubBase);
      if (!ok) {
        setError(LAN_PACK_HUB_DOWN_MESSAGE);
        logLanPack('health-fail', { hubBase, origin: window.location.origin });
        return null;
      }
      setError(null);
      return hubBase;
    }, [setError]);

    const importReceived = useCallback(
      async (file: File) => {
        setBusy(true);
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
          await onImported();
          logLanPack('imported', { origin: window.location.origin });
        } catch (err) {
          setError(
            err instanceof ProjectPackError || err instanceof Error
              ? err.message
              : 'インポートに失敗しました。',
          );
        } finally {
          setImportProgress(null);
          setBusy(false);
        }
      },
      [onImported, setError, setImportProgress],
    );

    const importReceivedRef = useRef(importReceived);
    importReceivedRef.current = importReceived;

    useEffect(() => {
      if (mode === 'send-code') {
        setRecvCode(null);
        return;
      }

      let stopped = false;
      const abort = new AbortController();

      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms);
        });

      const loop = async () => {
        let code: string | null = null;
        while (!stopped) {
          if (document.visibilityState === 'hidden') {
            setRecvCode(null);
            code = null;
            await sleep(500);
            continue;
          }
          const hubBase = hubBaseFromWindow();
          const alive = hubBase != null && (await probeLanPackHub(hubBase, abort.signal));
          if (stopped) {
            return;
          }
          if (!alive || hubBase == null) {
            setHubDown(true);
            setRecvCode(null);
            code = null;
            await sleep(8000);
            continue;
          }
          setHubDown(false);
          try {
            if (code == null) {
              const minted = await mintLanPackCode(hubBase, abort.signal);
              if (stopped) {
                return;
              }
              code = minted.code;
              setRecvCode(code);
              logLanPack('mint', { codeLen: code.length, origin: window.location.origin });
            }
            while (!stopped) {
              if (document.visibilityState === 'hidden') {
                break;
              }
              const got = await getLanPackZip(hubBase, code, abort.signal);
              if (stopped) {
                return;
              }
              if (got.status === 200 && got.file) {
                await importReceivedRef.current(got.file);
                continue;
              }
              if (got.status === 404) {
                code = null;
                setRecvCode(null);
                break;
              }
              await sleep(1500);
            }
          } catch (err) {
            if (abort.signal.aborted || stopped) {
              return;
            }
            logLanPack('recv-loop', { name: err instanceof Error ? err.name : 'x' });
            setHubDown(true);
            setRecvCode(null);
            code = null;
            await sleep(8000);
          }
        }
      };

      void loop();
      return () => {
        stopped = true;
        abort.abort();
      };
    }, [mode]);

    const startSend = useCallback(
      async (project: ProjectMeta) => {
        if (busy || listBusy) {
          return;
        }
        const hubBase = await requireHub();
        if (hubBase == null) {
          return;
        }
        setSendProjectId(project.id);
        setSendProjectName(project.name);
        setCodeInput('');
        setMode('send-code');
        setSendPhase('form');
        setStatus(LAN_PACK_PDF_NOTICE);
        setNotice(null);
      },
      [busy, listBusy, requireHub, setNotice],
    );

    useImperativeHandle(ref, () => ({ startSend }), [startSend]);

    const confirmSend = useCallback(async () => {
      if (busy || listBusy || sendProjectId == null || !isLanPackCode(codeInput)) {
        return;
      }
      const hubBase = await requireHub();
      if (hubBase == null) {
        return;
      }
      setBusy(true);
      setSendPhase('sending');
      setError(null);
      setNotice(null);
      const abort = new AbortController();
      sendAbortRef.current = abort;
      try {
        await waitForPaint();
        const file = await exportProjectPack(sendProjectId);
        if (abort.signal.aborted) {
          return;
        }
        logLanPack('put', { bytes: file.size, origin: window.location.origin });
        const statusCode = await putLanPackZip(hubBase, codeInput, file, abort.signal);
        if (abort.signal.aborted) {
          return;
        }
        if (statusCode === 204 || statusCode === 200) {
          setNotice(LAN_PACK_SENT);
          closeSend();
          return;
        }
        if (statusCode === 404) {
          setError(LAN_PACK_BAD_CODE);
          setSendPhase('form');
          return;
        }
        if (statusCode === 413) {
          setError(LAN_PACK_TOO_LARGE);
          setSendPhase('form');
          return;
        }
        setError(LAN_PACK_HUB_DOWN_MESSAGE);
        setSendPhase('form');
      } catch (err) {
        if (abort.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setError(err instanceof Error ? err.message : 'エクスポートに失敗しました。');
        setSendPhase('form');
      } finally {
        if (sendAbortRef.current === abort) {
          sendAbortRef.current = null;
        }
        setBusy(false);
      }
    }, [busy, closeSend, codeInput, listBusy, requireHub, sendProjectId, setError, setNotice]);

    return (
      <>
        {mode !== 'send-code' ? (
          <div className={styles.lanRecvStrip} aria-live="polite">
            {recvCode ? (
              <>
                <span className={styles.lanRecvLabel}>LAN受け取り</span>
                <span className={styles.lanCodeDisplay}>{recvCode}</span>
              </>
            ) : hubDown ? (
              <span className={styles.lanRecvHint}>{LAN_PACK_HUB_DOWN_MESSAGE}</span>
            ) : (
              <span className={styles.lanRecvHint}>LAN受け取りを準備しています…</span>
            )}
          </div>
        ) : null}
        {mode === 'send-code' ? (
          <div className={styles.lanModalRoot} role="dialog" aria-modal="true" aria-labelledby="lan-send-title">
            <div className={styles.lanModalBackdrop} />
            <div className={styles.lanModal}>
              <strong id="lan-send-title" className={styles.exportReadyLabel}>
                {sendProjectName ? `「${sendProjectName}」を送ります。` : 'LANで送る'}
              </strong>
              {sendPhase === 'form' ? (
                <>
                  <span className={styles.exportReadyLabel}>{status ?? LAN_PACK_PDF_NOTICE}</span>
                  <div className={styles.exportReadyActions}>
                    <input
                      className={styles.lanCodeInput}
                      type="text"
                      inputMode="text"
                      enterKeyHint="done"
                      autoComplete="one-time-code"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      maxLength={6}
                      value={codeInput}
                      autoFocus
                      aria-label="受け取り号"
                      onPointerDown={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        if (composingRef.current) {
                          setCodeInput(event.target.value);
                          return;
                        }
                        setCodeInput(normalizeLanPackDigits(event.target.value));
                      }}
                      onCompositionStart={() => {
                        composingRef.current = true;
                      }}
                      onCompositionEnd={(event) => {
                        composingRef.current = false;
                        setCodeInput(normalizeLanPackDigits(event.currentTarget.value));
                      }}
                    />
                    <button
                      type="button"
                      className={styles.newButton}
                      disabled={!isLanPackCode(codeInput) || sendProjectId == null}
                      onClick={() => void confirmSend()}
                    >
                      送る
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.lanSpinnerWrap} role="status" aria-label="送信中" aria-busy="true">
                  <span className={styles.lanSpinner} />
                </div>
              )}
              <button type="button" className={styles.secondaryButton} onClick={closeSend}>
                キャンセル
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  },
);
