'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadDocument } from '@/src/storage';
import { EditorMount } from '@/src/web/EditorMount';
import { EditorLoadingSurface } from '@/src/web/EditorLoadingSurface';

type EditorPageProps = {
  params: Promise<{ id: string }>;
};

function isValidProjectId(id: string): boolean {
  const trimmed = id.trim();
  return trimmed.length > 0 && trimmed.length <= 128 && /^[\w-]+$/.test(trimmed);
}

export default function EditorPage({ params }: EditorPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isValidProjectId(id)) {
      router.replace('/');
      return;
    }

    let cancelled = false;
    loadDocument(id).then((document) => {
      if (cancelled) {
        return;
      }
      if (!document) {
        router.replace('/');
        return;
      }
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  if (!ready) {
    return <EditorLoadingSurface />;
  }

  return <EditorMount projectId={id} />;
}
