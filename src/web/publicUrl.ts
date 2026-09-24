/** Same rule as scripts/pagesBasePath.mjs. Read at call time so the static build can inline it. */

function pagesBasePath(): string {
  const value = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim();
  if (!value || value === '/') {
    return '';
  }
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.replace(/\/$/, '');
}

export function pathnameWithoutBase(pathname: string): string {
  const base = pagesBasePath();
  if (!base) {
    return pathname;
  }
  if (pathname === base || pathname === `${base}/`) {
    return '/';
  }
  if (pathname.startsWith(`${base}/`)) {
    return pathname.slice(base.length);
  }
  return pathname;
}

export function publicUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = pagesBasePath();
  if (!base) {
    return normalized;
  }
  if (normalized === '/') {
    return `${base}/`;
  }
  return `${base}${normalized}`;
}
