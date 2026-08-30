export type ChromeTheme = 'light' | 'dark';

export const CHROME_THEME_STORAGE_KEY = 'ms-chrome-theme';

export function loadChromeTheme(): ChromeTheme {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  try {
    const stored = window.localStorage.getItem(CHROME_THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    /* private mode */
  }
  return 'dark';
}

export function saveChromeTheme(theme: ChromeTheme): void {
  try {
    window.localStorage.setItem(CHROME_THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
}

export function nextChromeTheme(theme: ChromeTheme): ChromeTheme {
  return theme === 'dark' ? 'light' : 'dark';
}
