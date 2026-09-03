'use client';

import { useEffect } from 'react';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // #region agent log
    ipadDebugLog({
      sessionId: 'adcc47',
      ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
      hypothesisId: 'C',
      location: 'app/error.tsx',
      message: 'Next error boundary',
      data: { msg: error.message, digest: error.digest ?? null, name: error.name },
    });
    // #endregion
  }, [error]);

  return (
    <main
      style={{
        padding: 24,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#2b2620',
      }}
    >
      <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>表示に失敗しました</h1>
      <p style={{ margin: '0 0 16px', color: '#6f675c' }}>{error.message}</p>
      <button type="button" onClick={() => reset()}>
        再試行
      </button>
    </main>
  );
}
