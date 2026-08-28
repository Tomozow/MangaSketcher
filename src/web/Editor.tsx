'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { EditorLayout } from '@/src/web/EditorLayout';
import { EditorLoadingSurface } from '@/src/web/EditorLoadingSurface';
import styles from '@/src/web/editor.module.css';
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
    setTextEditing,
    undo,
    redo,
    onPdfViewChange,
    onPickPdf,
    onDropTextRange,
    ink,
    inkFrame,
    marqueePreview,
    autosaveStatus,
    getPageThumb,
    getClipRasterSize,
  } = useEditorController(projectId);

  useEffect(() => {
    const lockScroll = () => {
      window.scrollTo(0, 0);
    };

    window.addEventListener('scroll', lockScroll, { passive: true });
    return () => window.removeEventListener('scroll', lockScroll);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const applyViewportHeight = () => {
      const root = document.getElementById('editor-root');
      if (!root) {
        return;
      }
      const height = viewport.height + viewport.offsetTop;
      root.style.height = `${height}px`;
    };

    applyViewportHeight();
    viewport.addEventListener('resize', applyViewportHeight);
    viewport.addEventListener('scroll', applyViewportHeight);
    return () => {
      viewport.removeEventListener('resize', applyViewportHeight);
      viewport.removeEventListener('scroll', applyViewportHeight);
    };
  }, []);

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
      <header className={styles.header}>
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
        onTextEditingChange={setTextEditing}
        onUndo={undo}
        onRedo={redo}
        onPdfViewChange={onPdfViewChange}
        onPickPdf={onPickPdf}
        onDropTextRange={onDropTextRange}
        inkEngine={ink?.engine ?? null}
        inkFrame={inkFrame}
        marqueePreview={marqueePreview}
        autosaveStatus={autosaveStatus}
        getPageThumb={getPageThumb}
        getClipRasterSize={getClipRasterSize}
      />
    </div>
  );
}
