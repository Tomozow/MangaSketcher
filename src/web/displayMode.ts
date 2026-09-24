export function isAppleTouchDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export const STANDALONE_HTML_ATTR = 'data-ms-display';
export const STANDALONE_HTML_VALUE = 'standalone';

/** Head inline script: mark html before first paint so 100lvh CSS applies. */
export const MARK_STANDALONE_SCRIPT = `(function(){try{var n=window.navigator;if(n.standalone||window.matchMedia('(display-mode: standalone)').matches||window.matchMedia('(display-mode: fullscreen)').matches){document.documentElement.setAttribute('${STANDALONE_HTML_ATTR}','${STANDALONE_HTML_VALUE}');}}catch(e){}})();`;

export function isStandaloneDisplay(input: {
  standalone?: boolean;
  displayModeStandalone?: boolean;
  displayModeFullscreen?: boolean;
}): boolean {
  return Boolean(input.displayModeStandalone || input.displayModeFullscreen || input.standalone);
}

export function readStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return isStandaloneDisplay({
    standalone: (window.navigator as { standalone?: boolean }).standalone,
    displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
    displayModeFullscreen: window.matchMedia('(display-mode: fullscreen)').matches,
  });
}

export function applyStandaloneHtmlFlag(standalone: boolean = readStandaloneDisplay()): void {
  if (standalone) {
    document.documentElement.setAttribute(STANDALONE_HTML_ATTR, STANDALONE_HTML_VALUE);
  } else {
    document.documentElement.removeAttribute(STANDALONE_HTML_ATTR);
  }
}

export function readAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return isAppleTouchDevice(navigator.userAgent, navigator.maxTouchPoints);
}

export function isGitHubPagesHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'github.io' || host.endsWith('.github.io');
}

/** PC loopback (Chrome --app included) shows the iPad CA QR; LAN iPad PWA and GitHub Pages do not. */
export function shouldShowIpadCaQr(input: {
  hostname: string;
  standalone: boolean;
  appleTouch: boolean;
}): boolean {
  if (isGitHubPagesHost(input.hostname)) {
    return false;
  }
  if (isLoopbackHost(input.hostname)) {
    return true;
  }
  return !input.standalone && !input.appleTouch;
}
