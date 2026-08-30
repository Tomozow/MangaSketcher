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

    // iOS: never register. An active SW makes Safari's ホーム画面に追加 fail
    // with 「エラーが出たためホーム画面に追加できませんでした」.
    if (isAppleTouchDevice()) {
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
