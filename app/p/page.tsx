'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadDocument } from '@/src/storage';
import { EditorMount } from '@/src/web/EditorMount';
import { EditorLoadingSurface } from '@/src/web/EditorLoadingSurface';
import { hardNavigate } from '@/src/web/hardNavigate';
import { publicUrl } from '@/src/web/publicUrl';
import { projectIdFromSearchParam } from '@/src/web/projectRoutes';

function EditorPageInner() {
  const searchParams = useSearchParams();
  const id = projectIdFromSearchParam(searchParams.get('id'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!id) {
      hardNavigate(publicUrl('/'), 'replace');
      return;
    }

    let cancelled = false;
    loadDocument(id).then((document) => {
      if (cancelled) {
        return;
      }
      if (!document) {
        hardNavigate(publicUrl('/'), 'replace');
        return;
      }
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id || !ready) {
    return <EditorLoadingSurface />;
  }

  return <EditorMount projectId={id} />;
}

export default function EditorPage() {
  return (
    <Suspense fallback={<EditorLoadingSurface />}>
      <EditorPageInner />
    </Suspense>
  );
}
