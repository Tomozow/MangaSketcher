'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { subscribeProjectExportCheckpoint } from '@/src/storage/projectExportCheckpoint';
import { bindHistoryShortcuts } from '@/src/input/historyShortcuts';
import { bindToolShortcuts } from '@/src/input/toolShortcuts';
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
    dispatch,
    applyWorkspaceEffects,
    commitTextEdit,
    deleteText,
    duplicateText,
    deleteClip,
    duplicateClip,
    insertClipOnPage,
    setTextEditing,
    undo,
    redo,
    onPdfViewChange,
    onPickPdf,
    onExtractPdfText,
    ink,
    inkFrame,
    marqueePreview,
    clipLiveTransforms,
    textLiveTransforms,
    autosaveStatus,
    getPageThumb,
    getClipRasterSize,
    clearPageInk,
    checkpointBeforeHeavyWork,
    setTextDraft,
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

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    return bindToolShortcuts((tool) => {
      dispatch({ type: 'setTool', tool });
    });
  }, [ready, dispatch]);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    return bindHistoryShortcuts({ onUndo: undo, onRedo: redo });
  }, [ready, undo, redo]);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    return subscribeProjectExportCheckpoint({
      projectId,
      checkpoint: checkpointBeforeHeavyWork,
    });
  }, [ready, projectId, checkpointBeforeHeavyWork]);

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
        ['--ms-background' as string]: colors.background,
        ['--ms-surface' as string]: colors.surface,
        ['--ms-surface-muted' as string]: colors.surfaceMuted,
        ['--ms-border' as string]: colors.border,
        ['--ms-text' as string]: colors.text,
        ['--ms-text-muted' as string]: colors.textMuted,
        ['--ms-accent' as string]: colors.accent,
      }}
    >
      <EditorLayout
        doc={history.present}
        history={history}
        pdfMissing={pdfMissing}
        pdfBytes={pdfBytes}
        textEditing={textEditing}
        textSelection={textSelection}
        dispatch={dispatch}
        applyWorkspaceEffects={applyWorkspaceEffects}
        commitTextEdit={commitTextEdit}
        deleteText={deleteText}
        duplicateText={duplicateText}
        deleteClip={deleteClip}
        duplicateClip={duplicateClip}
        insertClipOnPage={insertClipOnPage}
        onTextEditingChange={setTextEditing}
        onUndo={undo}
        onRedo={redo}
        onPdfViewChange={onPdfViewChange}
        onPickPdf={onPickPdf}
        onExtractPdfText={onExtractPdfText}
        inkEngine={ink?.engine ?? null}
        inkFrame={inkFrame}
        rasterLayoutGen={ink?.rasterLayoutGen ?? 0}
        marqueePreview={marqueePreview}
        clipLiveTransforms={clipLiveTransforms}
        textLiveTransforms={textLiveTransforms}
        autosaveStatus={autosaveStatus}
        getPageThumb={getPageThumb}
        getClipRasterSize={getClipRasterSize}
        clearPageInk={clearPageInk}
        onNavigateHome={checkpointBeforeHeavyWork}
        onTextDraftChange={setTextDraft}
      />
    </div>
  );
}
