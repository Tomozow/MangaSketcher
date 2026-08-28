'use client';

import dynamic from 'next/dynamic';
import { EditorLoadingSurface } from '@/src/web/EditorLoadingSurface';

const Editor = dynamic(() => import('@/src/web/Editor'), {
  ssr: false,
  loading: () => <EditorLoadingSurface />,
});

type EditorMountProps = {
  projectId: string;
};

export function EditorMount({ projectId }: EditorMountProps) {
  return <Editor projectId={projectId} />;
}
