import { useLayoutEffect, useState } from 'react';
import { applyStandaloneHtmlFlag, readStandaloneDisplay } from '@/src/web/displayMode';

/** Shrink for keyboard, not for iPad Safari's phantom bottom chrome in standalone. */
export const STANDALONE_KEYBOARD_SHRINK_PX = 100;

export function appShellHeight(options: {
  innerHeight: number;
  visualHeight: number | null;
  visualOffsetTop: number;
  standalone: boolean;
}): number | null {
  const { innerHeight, visualHeight, visualOffsetTop, standalone } = options;
  const visual =
    visualHeight == null || !Number.isFinite(visualHeight)
      ? innerHeight
      : visualHeight + visualOffsetTop;
  if (!standalone) {
    return visual;
  }
  if (innerHeight - visual > STANDALONE_KEYBOARD_SHRINK_PX) {
    return visual;
  }
  return null;
}

export function readAppShellHeight(): number | null {
  const viewport = window.visualViewport;
  return appShellHeight({
    innerHeight: window.innerHeight,
    visualHeight: viewport ? viewport.height : null,
    visualOffsetTop: viewport?.offsetTop ?? 0,
    standalone: readStandaloneDisplay(),
  });
}

export function useAppShellHeight(remeasureKey?: unknown): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const apply = () => {
      applyStandaloneHtmlFlag();
      setHeight(readAppShellHeight());
    };
    apply();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', apply);
    viewport?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    return () => {
      viewport?.removeEventListener('resize', apply);
      viewport?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  }, [remeasureKey]);

  return height;
}
