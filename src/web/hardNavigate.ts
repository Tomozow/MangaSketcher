export function hardNavigate(href: string, mode: 'assign' | 'replace' = 'assign'): void {
  if (mode === 'replace') {
    window.location.replace(href);
    return;
  }
  window.location.assign(href);
}
