import { useLayoutEffect, useState } from 'react';
import { applyStandaloneHtmlFlag, readStandaloneDisplay } from '@/src/web/displayMode';

/** Shrink for keyboard, not for iPad Safari's phantom bottom chrome in standalone. */
export const STANDALONE_KEYBOARD_SHRINK_PX = 100;

export function appShellHeight(options: {
  innerHeight: number;
  visualHeight: number | null;
  visualOffsetTop: number;
  standalone: boolean;
  /** Text HUD: keep the layout viewport. Do not shrink the workspace for the keyboard. */
  ignoreVisualKeyboard?: boolean;
}): number | null {
  const { innerHeight, visualHeight, visualOffsetTop, standalone, ignoreVisualKeyboard } = options;
  if (ignoreVisualKeyboard) {
    return standalone ? null : innerHeight;
  }
  const visual =
    visualHeight == null || !Number.isFinite(visualHeight)
      ? innerHeight
      : visualHeight + visualOffsetTop;
  const keyboardish = innerHeight - visual > STANDALONE_KEYBOARD_SHRINK_PX;
  if (ignoreVisualKeyboard || keyboardish) {
    return standalone ? null : innerHeight;
  }
  if (!standalone) {
    return visual;
  }
  return null;
}

export function readAppShellHeight(ignoreVisualKeyboard = false): number | null {
  const viewport = window.visualViewport;
  return appShellHeight({
    innerHeight: window.innerHeight,
    visualHeight: viewport ? viewport.height : null,
    visualOffsetTop: viewport?.offsetTop ?? 0,
    standalone: readStandaloneDisplay(),
    ignoreVisualKeyboard,
  });
}

export function useAppShellHeight(remeasureKey?: unknown, ignoreVisualKeyboard = false): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const apply = () => {
      applyStandaloneHtmlFlag();
      setHeight(readAppShellHeight(ignoreVisualKeyboard));
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
  }, [remeasureKey, ignoreVisualKeyboard]);

  return height;
}
