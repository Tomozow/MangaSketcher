'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EditorLoadingSurface } from '@/src/web/EditorLoadingSurface';
import { legacyProjectIdFromPathname, projectHref } from '@/src/web/projectRoutes';

export default function NotFound() {
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const id = legacyProjectIdFromPathname(window.location.pathname);
    if (id) {
      window.location.replace(projectHref(id));
      return;
    }
    setShowFallback(true);
  }, []);

  if (!showFallback) {
    return <EditorLoadingSurface />;
  }

  return (
    <main
      style={{
        padding: 24,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#2b2620',
      }}
    >
      <h1 style={{ fontSize: 18, margin: '0 0 12px' }}>ページが見つかりません</h1>
      <Link href="/">プロジェクト一覧へ</Link>
    </main>
  );
}
