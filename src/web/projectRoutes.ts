import { pathnameWithoutBase, publicUrl } from '@/src/web/publicUrl';

const PROJECT_ID_PATTERN = /^[\w-]+$/;

export function isValidProjectId(id: string): boolean {
  const trimmed = id.trim();
  return trimmed.length > 0 && trimmed.length <= 128 && PROJECT_ID_PATTERN.test(trimmed);
}

export function projectHref(id: string): string {
  return `${publicUrl('/p/')}?id=${encodeURIComponent(id)}`;
}

export function projectIdFromSearchParam(id: string | null | undefined): string | null {
  if (id == null) {
    return null;
  }
  const trimmed = id.trim();
  return isValidProjectId(trimmed) ? trimmed : null;
}

/** `/p/:id` bookmarks from the previous App Router path. */
export function legacyProjectIdFromPathname(pathname: string): string | null {
  const match = pathnameWithoutBase(pathname).match(/^\/p\/([^/]+)\/?$/);
  if (!match) {
    return null;
  }
  try {
    const id = decodeURIComponent(match[1]);
    return isValidProjectId(id) ? id : null;
  } catch {
    return null;
  }
}
