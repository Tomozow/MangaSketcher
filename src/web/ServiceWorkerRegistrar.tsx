'use client';

import { useEffect } from 'react';

function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    Boolean((window.navigator as { standalone?: boolean }).standalone)
  );
}

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((reg) => reg.unregister())),
      );
      return;
    }

    // iOS Safari: SW install + clients.claim reloads the tab and aborts
    // 「ホーム画面に追加」. Register only after the web clip is already installed.
    if (isAppleTouchDevice() && !isStandaloneDisplay()) {
      void navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((reg) => reg.unregister())),
      );
      return;
    }

    const timer = window.setTimeout(() => {
      void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    }, 1500);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
