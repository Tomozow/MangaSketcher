import { releaseDefaultStorageDatabase } from '@/src/storage/idb';

export function hardNavigate(href: string, mode: 'assign' | 'replace' = 'assign'): void {
  releaseDefaultStorageDatabase();
  if (mode === 'replace') {
    window.location.replace(href);
    return;
  }
  window.location.assign(href);
}
