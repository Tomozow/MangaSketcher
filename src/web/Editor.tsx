'use client';

import { useEffect, useRef } from 'react';
import { useAppShellHeight } from '@/src/web/appShellHeight';
import { subscribeProjectExportCheckpoint } from '@/src/storage/projectExportCheckpoint';
import { bindHistoryShortcuts } from '@/src/input/historyShortcuts';
import { bindStylusPenEraserToggle, bindToolShortcuts } from '@/src/input/toolShortcuts';
import { EditorLayout } from '@/src/web/EditorLayout';
import { EditorLoadingSurface } from '@/src/web/EditorLoadingSurface';
import { styles } from '@/src/web/editorStyles';
import { useAppSettings } from '@/src/web/useAppSettings';
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
    lassoPreview,
    clipLiveTransforms,
    textLiveTransforms,
    autosaveStatus,
    getPageThumb,
    getClipRasterSize,
    clearPageInk,
    checkpointBeforeHeavyWork,
    setTextDraft,
  } = useEditorController(projectId);
  const [appSettings] = useAppSettings();
  const rootHeight = useAppShellHeight(ready);
  const toolRef = useRef(history?.present.tool ?? 'pen');
  toolRef.current = history?.present.tool ?? 'pen';

  useEffect(() => {
    const lockScroll = () => {
      window.scrollTo(0, 0);
    };

    window.addEventListener('scroll', lockScroll, { passive: true });
    return () => window.removeEventListener('scroll', lockScroll);
  }, []);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    const unbindKeys = bindToolShortcuts((tool) => {
      dispatch({ type: 'setTool', tool });
    }, window, appSettings.shortcuts);
    const unbindStylus = bindStylusPenEraserToggle(
      () => toolRef.current,
      (tool) => {
        dispatch({ type: 'setTool', tool });
      },
    );
    return () => {
      unbindKeys();
      unbindStylus();
    };
  }, [ready, dispatch, appSettings.shortcuts]);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    return bindHistoryShortcuts({ onUndo: undo, onRedo: redo }, window, appSettings.shortcuts);
  }, [ready, undo, redo, appSettings.shortcuts]);

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
        ...(rootHeight != null ? { height: `${rootHeight}px` } : {}),
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
        marqueePreview={marqueePreview}
        lassoPreview={lassoPreview}
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
