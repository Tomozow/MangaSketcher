'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
