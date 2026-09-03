import { releaseDefaultStorageDatabase } from '@/src/storage/idb';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

export function hardNavigate(href: string, mode: 'assign' | 'replace' = 'assign'): void {
  // #region agent log
  ipadDebugLog({
    sessionId: 'adcc47',
    ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
    hypothesisId: 'F',
    location: 'hardNavigate.ts',
    message: 'hardNavigate release then go',
    data: { href, mode },
  });
  // #endregion
  releaseDefaultStorageDatabase();
  if (mode === 'replace') {
    window.location.replace(href);
    return;
  }
  window.location.assign(href);
}
