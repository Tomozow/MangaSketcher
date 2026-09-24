/** GitHub Pages project site prefix. Empty for user sites and local static hosting. */

export function pagesBasePath(raw = process.env.NEXT_PUBLIC_BASE_PATH) {
  const value = String(raw ?? '').trim();
  if (!value || value === '/') {
    return '';
  }
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.replace(/\/$/, '');
}

export function withPagesBase(path, base = pagesBasePath()) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!base) {
    return normalized;
  }
  if (normalized === '/') {
    return `${base}/`;
  }
  return `${base}${normalized}`;
}
