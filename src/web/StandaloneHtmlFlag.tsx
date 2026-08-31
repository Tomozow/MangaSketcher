'use client';

import { useLayoutEffect } from 'react';
import { applyStandaloneHtmlFlag, readStandaloneDisplay } from '@/src/web/displayMode';

/** Keeps html[data-ms-display=standalone] in sync after hydration. */
export function StandaloneHtmlFlag() {
  useLayoutEffect(() => {
    const apply = () => {
      applyStandaloneHtmlFlag(readStandaloneDisplay());
    };
    apply();
    const standaloneMq = window.matchMedia('(display-mode: standalone)');
    const fullscreenMq = window.matchMedia('(display-mode: fullscreen)');
    standaloneMq.addEventListener('change', apply);
    fullscreenMq.addEventListener('change', apply);
    return () => {
      standaloneMq.removeEventListener('change', apply);
      fullscreenMq.removeEventListener('change', apply);
    };
  }, []);
  return null;
}
