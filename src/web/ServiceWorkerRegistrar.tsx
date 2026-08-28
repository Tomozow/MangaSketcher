'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration is best-effort in dev; shell still loads without it.
    });
  }, []);

  return null;
}
