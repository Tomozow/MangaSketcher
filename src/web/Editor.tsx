'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useState } from 'react';
import { EditorLayout } from '@/src/web/EditorLayout';
import { EditorLoadingSurface } from '@/src/web/EditorLoadingSurface';
import { styles } from '@/src/web/editorStyles';
import { colors, useEditorController } from '@/src/web/useEditorController';

type EditorProps = {
  projectId: string;
};

export default function Editor({ projectId }: EditorProps) {
  const {
    ready,
    missing,
    history,
    pdfMissing,
    pdfBytes,
    textEditing,
    textSelection,
    viewportBottom,
    dispatch,
    applyWorkspaceEffects,
    commitTextEdit,
    deleteText,
    duplicateText,
    setTextEditing,
    undo,
    redo,
    onPdfViewChange,
    onPickPdf,
    onDropTextRange,
    ink,
    inkFrame,
    marqueePreview,
    clipLiveTransforms,
    textLiveTransforms,
    autosaveStatus,
    getPageThumb,
    getClipRasterSize,
  } = useEditorController(projectId);
  const [rootHeight, setRootHeight] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : window.innerHeight,
  );

  useEffect(() => {
    const lockScroll = () => {
      window.scrollTo(0, 0);
    };

    window.addEventListener('scroll', lockScroll, { passive: true });
    return () => window.removeEventListener('scroll', lockScroll);
  }, []);

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const applyViewportHeight = () => {
      const height = viewport
        ? viewport.height + viewport.offsetTop
        : window.innerHeight;
      setRootHeight(height);
    };

    applyViewportHeight();
    viewport?.addEventListener('resize', applyViewportHeight);
    viewport?.addEventListener('scroll', applyViewportHeight);
    window.addEventListener('resize', applyViewportHeight);
    return () => {
      viewport?.removeEventListener('resize', applyViewportHeight);
      viewport?.removeEventListener('scroll', applyViewportHeight);
      window.removeEventListener('resize', applyViewportHeight);
    };
  }, [ready]);

  if (missing) {
    return null;
  }

  if (!ready || !history) {
    return <EditorLoadingSurface />;
  }

  return (
    <div
      id="editor-root"
      className={styles.editorRoot}
      style={{
        height: rootHeight != null ? `${rootHeight}px` : '100dvh',
        background: colors.background,
        ['--ms-background' as string]: colors.background,
        ['--ms-surface' as string]: colors.surface,
        ['--ms-surface-muted' as string]: colors.surfaceMuted,
        ['--ms-border' as string]: colors.border,
        ['--ms-text' as string]: colors.text,
        ['--ms-text-muted' as string]: colors.textMuted,
        ['--ms-accent' as string]: colors.accent,
      }}
    >
      <header className={styles.header} data-ms-shell="header">
        <Link href="/" className={styles.linkButton}>
          一覧へ
        </Link>
        <h1 className={styles.headerTitle}>{history.present.name}</h1>
      </header>
      <EditorLayout
        doc={history.present}
        history={history}
        pdfMissing={pdfMissing}
        pdfBytes={pdfBytes}
        textEditing={textEditing}
        textSelection={textSelection}
        viewportBottom={viewportBottom}
        dispatch={dispatch}
        applyWorkspaceEffects={applyWorkspaceEffects}
        commitTextEdit={commitTextEdit}
        deleteText={deleteText}
        duplicateText={duplicateText}
        onTextEditingChange={setTextEditing}
        onUndo={undo}
        onRedo={redo}
        onPdfViewChange={onPdfViewChange}
        onPickPdf={onPickPdf}
        onDropTextRange={onDropTextRange}
        inkEngine={ink?.engine ?? null}
        inkFrame={inkFrame}
        marqueePreview={marqueePreview}
        clipLiveTransforms={clipLiveTransforms}
        textLiveTransforms={textLiveTransforms}
        autosaveStatus={autosaveStatus}
        getPageThumb={getPageThumb}
        getClipRasterSize={getClipRasterSize}
      />
    </div>
  );
}
