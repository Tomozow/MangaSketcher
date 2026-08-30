'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  loadChromeTheme,
  nextChromeTheme,
  saveChromeTheme,
  type ChromeTheme,
} from './chromeTheme';

export function useChromeTheme(): {
  theme: ChromeTheme;
  toggleTheme: () => void;
} {
  const [theme, setTheme] = useState<ChromeTheme>('dark');

  useEffect(() => {
    setTheme(loadChromeTheme());
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = nextChromeTheme(current);
      saveChromeTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
