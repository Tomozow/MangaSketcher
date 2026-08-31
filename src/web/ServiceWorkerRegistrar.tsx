'use client';

import { useEffect } from 'react';
import { isLoopbackHost, readAppleTouchDevice, readStandaloneDisplay } from '@/src/web/displayMode';
import {
  SHELL_PROBE_TIMEOUT_MS,
  probeShellServer,
  readShellUpdateSession,
  restoreShellUpdateSession,
  runShellStartup,
  setShellUpdateStatus,
  writeShellUpdateSession,
} from '@/src/web/shellUpdate';

async function runBrowserShellStartup(): Promise<void> {
  await runShellStartup({
    getRegistration: () => navigator.serviceWorker.getRegistration(),
    register: () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }),
    probe: () => probeShellServer(window.fetch.bind(window), SHELL_PROBE_TIMEOUT_MS),
    readSession: () => readShellUpdateSession(window.sessionStorage),
    writeSession: (status) => writeShellUpdateSession(window.sessionStorage, status),
    reload: () => window.location.reload(),
    setStatus: setShellUpdateStatus,
  });
}

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== 'production' || isLoopbackHost(window.location.hostname)) {
      void navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((reg) => reg.unregister())),
      );
      return;
    }

    // iOS Safari tab: never register. An active SW here makes 「ホーム画面に追加」
    // fail. The home-screen web app (standalone) registers separately.
    if (readAppleTouchDevice() && !readStandaloneDisplay()) {
      return;
    }

    if (restoreShellUpdateSession(window.sessionStorage)) {
      return;
    }

    let cancelled = false;
    let timer = 0;
    const delayMs = readAppleTouchDevice() ? 0 : 1500;

    void navigator.serviceWorker.getRegistration().then((existing) => {
      if (cancelled) {
        return;
      }
      if (existing) {
        void runBrowserShellStartup().catch(() => {});
        return;
      }
      timer = window.setTimeout(() => {
        if (!cancelled) {
          void runBrowserShellStartup().catch(() => {});
        }
      }, delayMs);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
