'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
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
