'use client';

import { useEffect } from 'react';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

// #region agent log
const AGENT_DEBUG_INGEST = 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426';
let globalHookInstalled = false;
let globalErrorCount = 0;

function dbgGlobal(hypothesisId: string, location: string, message: string, data?: Record<string, unknown>): void {
  if (globalErrorCount > 24) {
    return;
  }
  globalErrorCount += 1;
  ipadDebugLog({
    sessionId: '092972',
    ingest: AGENT_DEBUG_INGEST,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  });
}

function installGlobalIdbErrorHooks(): void {
  if (globalHookInstalled || typeof window === 'undefined') {
    return;
  }
  globalHookInstalled = true;
  dbgGlobal('G', 'ServiceWorkerRegistrar.tsx:install', 'global error hooks installed', {});
  window.addEventListener('error', (event) => {
    dbgGlobal('G', 'window:error', 'window error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      name: event.error instanceof Error ? event.error.name : '',
      stack: event.error instanceof Error ? event.error.stack?.slice(0, 800) : '',
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    dbgGlobal('G', 'window:unhandledrejection', 'unhandledrejection', {
      name: reason instanceof Error ? reason.name : typeof reason,
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack?.slice(0, 800) : '',
    });
  });
  if (typeof IDBObjectStore !== 'undefined') {
    const origDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function patchedDelete(query) {
      try {
        return origDelete.call(this, query);
      } catch (err) {
        dbgGlobal('F', 'IDBObjectStore.delete', 'IDB delete threw', {
          store: this.name,
          name: err instanceof Error ? err.name : '',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.slice(0, 800) : '',
        });
        throw err;
      }
    };
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function patchedPut(value, key) {
      try {
        return origPut.call(this, value, key);
      } catch (err) {
        dbgGlobal('F', 'IDBObjectStore.put', 'IDB put threw', {
          store: this.name,
          name: err instanceof Error ? err.name : '',
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    };
  }
}
// #endregion

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // #region agent log
    installGlobalIdbErrorHooks();
    // #endregion
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    // Dev HMR (iPad Safari/LAN) is blocked by a cached SW. Unregister in development.
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((reg) => reg.unregister())),
      );
      return;
    }

    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration is best-effort; shell still loads without it.
    });
  }, []);

  return null;
}
