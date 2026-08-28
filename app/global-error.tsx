'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          padding: 24,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f4f1ea',
          color: '#2b2620',
        }}
      >
        <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>アプリを読み込めませんでした</h1>
        <p style={{ margin: '0 0 16px', color: '#6f675c' }}>{error.message}</p>
        <button type="button" onClick={() => reset()}>
          再読み込み
        </button>
      </body>
    </html>
  );
}
