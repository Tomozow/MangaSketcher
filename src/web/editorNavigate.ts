import { ipadDebugLog } from '@/src/web/ipadDebugLog';
import { publicUrl } from '@/src/web/publicUrl';

export async function navigateHomeAfterCheckpoint(
  checkpoint: () => Promise<void>,
  push: (path: string) => void,
): Promise<boolean> {
  try {
    await checkpoint();
    // #region agent log
    ipadDebugLog({
      sessionId: 'adcc47',
      ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
      hypothesisId: 'B',
      location: 'editorNavigate.ts:ok',
      message: 'checkpoint ok, navigating home',
    });
    // #endregion
    push(publicUrl('/'));
    return true;
  } catch (err) {
    // #region agent log
    ipadDebugLog({
      sessionId: 'adcc47',
      ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
      hypothesisId: 'B',
      location: 'editorNavigate.ts:fail',
      message: 'checkpoint failed',
      data: {
        name: err instanceof Error ? err.name : typeof err,
        msg: err instanceof Error ? err.message : String(err),
      },
    });
    // #endregion
    return false;
  }
}
