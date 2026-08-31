export function isAppleTouchDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

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

export function readAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return isAppleTouchDevice(navigator.userAgent, navigator.maxTouchPoints);
}
