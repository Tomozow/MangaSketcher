'use client';

import { useEffect } from 'react';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

function log(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  ipadDebugLog({
    sessionId: 'adcc47',
    ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
    hypothesisId,
    location,
    message,
    data,
  });
}

export function DebugErrorProbe() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // #region agent log
      log('F', 'DebugErrorProbe:error', 'window error', {
        msg: event.message,
        filename: event.filename,
        lineno: event.lineno,
      });
      // #endregion
    };
    const onReject = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      // #region agent log
      log('F', 'DebugErrorProbe:rejection', 'unhandledrejection', {
        name: reason instanceof Error ? reason.name : typeof reason,
        msg: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? (reason.stack ?? '').slice(0, 400) : '',
      });
      // #endregion
    };
    const original = console.error;
    console.error = (...args: unknown[]) => {
      // #region agent log
      log('G', 'DebugErrorProbe:console.error', 'console.error', {
        text: args.map((arg) => (arg instanceof Error ? `${arg.name}:${arg.message}` : String(arg))).join(' | ').slice(0, 500),
      });
      // #endregion
      original.apply(console, args);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onReject);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onReject);
      console.error = original;
    };
  }, []);

  return null;
}
