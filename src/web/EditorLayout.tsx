'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { mainPaneFlex, nextSplitFromDrag, sidebarPaneFlex } from '@/src/domain/uiLayout';
import type { PageId, Rect } from '@/src/domain/types';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import type { EditorDocument, EditorHistory } from '@/src/storage/types';
import type { AutosaveStatus } from '@/src/storage/autosave';
import type { WorkspaceEffect } from '@/src/web/gestures';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import type { MarqueePreview, ClipLiveTransform, TextLiveTransform } from '@/src/web/useEditorController';
import { colors } from '@/src/theme/tokens';
import { styles } from './editorStyles';
import { CompactSidebar } from './CompactSidebar';
import { PdfPanePlaceholder } from './PdfPanePlaceholder';
import { SplitHandle } from './SplitHandle';
import { StockPane, type WorkspaceGrab } from './StockPane';
import { PageInkOverlay } from './PageInkOverlay';
import { TextEditBar } from './TextEditBar';
import type { TextEditSelection } from '@/src/web/TextEditBar';
import { WorkspaceStrip } from './WorkspaceStrip';

type EditorLayoutProps = {
  doc: EditorDocument;
  history: EditorHistory;
  pdfMissing: boolean;
  textEditing: boolean;
  textSelection: TextEditSelection | null;
  dispatch: (action: EditorDocumentAction) => void;
  applyWorkspaceEffects: (
    effects: WorkspaceEffect[],
    fingerPositions: Map<number, { x: number; y: number }>,
    surfaceRect: DOMRect | null,
  ) => string | null | undefined;
  commitTextEdit: (textId: string, content: string) => void;
  deleteText: (textId: string) => void;
  duplicateText: (textId: string) => void;
  onTextEditingChange: (editing: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  pdfBytes: ArrayBuffer | null;
  onPdfViewChange: (patch: {
    currentPage?: number;
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
  onPickPdf: (file: File) => Promise<void>;
  onDropTextRange: (payload: { pdfPage: number; range: Rect; preview: string }) => void;
  inkEngine: InkEngine | null;
  inkFrame: number;
  marqueePreview: MarqueePreview | null;
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
  autosaveStatus: AutosaveStatus;
  getPageThumb: (pageId: PageId) => ImageBitmap | undefined;
  getClipRasterSize: (clipId: string) => { width: number; height: number };
};

export function EditorLayout({
  doc,
  history,
  pdfMissing,
  textEditing,
  textSelection,
  dispatch,
  applyWorkspaceEffects,
  commitTextEdit,
  deleteText,
  duplicateText,
  onTextEditingChange,
  onUndo,
  onRedo,
  pdfBytes,
  onPdfViewChange,
  onPickPdf,
  onDropTextRange,
  inkEngine,
  inkFrame,
  marqueePreview,
  clipLiveTransforms,
  textLiveTransforms,
  autosaveStatus,
  getPageThumb,
  getClipRasterSize,
}: EditorLayoutProps) {
  const mainFlex = mainPaneFlex(doc);
  const sideFlex = sidebarPaneFlex(doc);
  const sidebarClass = doc.sidebarCompact ? styles.sidebarCompact : styles.sidebarNormal;
  const [workspaceGrab, setWorkspaceGrab] = useState<WorkspaceGrab | null>(null);
  const [liveTextDraft, setLiveTextDraft] = useState<string | null>(null);

  const handleWorkspaceEffects = useCallback(
    (
      effects: WorkspaceEffect[],
      fingerPositions: Map<number, { x: number; y: number }>,
      surfaceRect: DOMRect | null,
    ) => {
      for (const effect of effects) {
        if (effect.type === 'grabPage') {
          setWorkspaceGrab({ pageId: effect.pageId, fromIndex: effect.fromIndex });
        }
      }
      return applyWorkspaceEffects(effects, fingerPositions, surfaceRect);
    },
    [applyWorkspaceEffects],
  );

  const handleWorkspacePdfDrag = (deltaPx: number) => {
    const mainEl = document.getElementById('editor-main-split');
    const total = mainEl?.clientWidth ?? 1;
    const next = nextSplitFromDrag(doc.workspacePdfSplit, deltaPx, total);
    dispatch({ type: 'setUiLayout', workspacePdfSplit: next });
  };

  const handlePaletteStockDrag = (deltaPx: number) => {
    const sideEl = document.getElementById('editor-sidebar-split');
    const splitCol = sideEl?.querySelector('[data-ms-shell="split-col"]');
    const total = (splitCol instanceof HTMLElement ? splitCol.clientHeight : sideEl?.clientHeight) ?? 1;
    const next = nextSplitFromDrag(doc.paletteStockSplit, deltaPx, total);
    dispatch({ type: 'setUiLayout', paletteStockSplit: next });
  };

  return (
    <div className={styles.body} data-ms-shell="body" style={{ ['--ms-background' as string]: colors.background }}>
      <div
        id="editor-sidebar-split"
        className={`${styles.sidebarColumn} ${sidebarClass}`}
        data-ms-sidebar={doc.sidebarCompact ? 'compact' : 'normal'}
      >
        <div className={styles.navRow} data-ms-shell="nav">
          <Link href="/" className={styles.linkButton}>
            一覧へ
          </Link>
          <h1 className={styles.headerTitle}>{doc.name}</h1>
          <div
            className={styles.saveStatusRow}
            data-ms-save={
              autosaveStatus.encodingCount > 0
                ? 'encoding'
                : autosaveStatus.unsaved
                  ? 'unsaved'
                  : 'idle'
            }
            aria-live="polite"
            aria-hidden={
              !autosaveStatus.unsaved && autosaveStatus.encodingCount === 0
            }
          >
            <span
              className={`${styles.saveStatusDot} ${
                autosaveStatus.encodingCount > 0
                  ? styles.saveStatusEncoding
                  : styles.saveStatusUnsaved
              }`}
              aria-hidden
            />
            <span className={styles.saveStatusLabel}>
              {autosaveStatus.encodingCount > 0 ? 'エンコード中' : '未保存'}
            </span>
          </div>
        </div>
        <div className={styles.splitCol} data-ms-shell="split-col">
          <div
            className={styles.pane}
            data-ms-shell="pane"
            style={{ flexGrow: sideFlex.palette, flexShrink: 1, flexBasis: 0 }}
          >
            <span className={styles.paneLabel} data-ms-shell="pane-label">ツール</span>
            <CompactSidebar
              doc={doc}
              history={history}
              textEditing={textEditing}
              dispatch={dispatch}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          </div>
          <SplitHandle orientation="vertical" onDrag={handlePaletteStockDrag} />
          <div
            className={styles.pane}
            data-ms-shell="pane"
            style={{ flexGrow: sideFlex.stock, flexShrink: 1, flexBasis: 0 }}
          >
            <span className={styles.paneLabel} data-ms-shell="pane-label">ストック</span>
            <StockPane
              doc={doc}
              dispatch={dispatch}
              workspaceGrab={workspaceGrab}
              onWorkspaceGrabEnd={() => setWorkspaceGrab(null)}
              getPageThumb={getPageThumb}
            />
          </div>
        </div>
      </div>

      <div id="editor-main-split" className={styles.mainColumn}>
        <div className={styles.splitRow} data-ms-shell="split-row">
          <div
            id="editor-workspace-pane"
            className={styles.pane}
            data-ms-shell="pane"
            style={{ flexGrow: mainFlex.workspace, flexShrink: 1, flexBasis: 0 }}
          >
            <span className={styles.paneLabel} data-ms-shell="pane-label">ワークスペース</span>
            <WorkspaceStrip
              workspaceOrder={doc.workspaceOrder}
              pages={doc.pages}
              pasteboardClips={doc.pasteboardClips}
              clipLiveTransforms={clipLiveTransforms}
              pasteboardTexts={doc.pasteboardTexts}
              selectedPageId={doc.selectedPageId}
              selectedClipId={doc.selectedClipId}
              tool={doc.tool}
              zoom={doc.workspaceZoom}
              panX={doc.workspacePanX}
              panY={doc.workspacePanY}
              rasterWidth={doc.rasterWidth}
              rasterHeight={doc.rasterHeight}
              getClipRasterSize={getClipRasterSize}
              applyWorkspaceEffects={handleWorkspaceEffects}
              getPageThumb={getPageThumb}
              selectedTextId={doc.selectedTextId}
              textLiveTransforms={textLiveTransforms}
              liveTextContent={
                textSelection && liveTextDraft !== null
                  ? { id: textSelection.id, content: liveTextDraft }
                  : null
              }
              onDeleteText={deleteText}
            />
            {inkEngine ? (
              <PageInkOverlay
                doc={doc}
                engine={inkEngine}
                inkFrame={inkFrame}
                marqueePreview={marqueePreview}
                clipLiveTransforms={clipLiveTransforms}
              />
            ) : null}
          </div>

          {doc.pdfViewerVisible ? (
            <>
              <SplitHandle orientation="horizontal" onDrag={handleWorkspacePdfDrag} />
              <div
                className={styles.pane}
                data-ms-shell="pane"
                style={{ flexGrow: mainFlex.pdf, flexShrink: 1, flexBasis: 0 }}
              >
                <span className={styles.paneLabel} data-ms-shell="pane-label">PDF</span>
                <PdfPanePlaceholder
                  visible
                  hasPdf={Boolean(doc.pdf)}
                  pdfMissing={pdfMissing}
                  pdfBytes={pdfBytes}
                  pdf={
                    doc.pdf
                      ? {
                          opfsPath: doc.pdf.opfsPath,
                          generation: doc.pdf.generation,
                          currentPage: doc.pdf.currentPage,
                          pageCount: doc.pdf.pageCount,
                          zoom: doc.pdf.zoom,
                          panX: doc.pdf.panX,
                          panY: doc.pdf.panY,
                          sourceTextByPage: doc.pdf.sourceTextByPage,
                        }
                      : null
                  }
                  onViewChange={onPdfViewChange}
                  onPickPdf={onPickPdf}
                  onDropTextRange={onDropTextRange}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
      <TextEditBar
        selection={textSelection}
        layoutKey={`${doc.workspaceZoom}:${doc.workspacePanX}:${doc.workspacePanY}:${
          textSelection ? JSON.stringify(textLiveTransforms[textSelection.id] ?? null) : ''
        }`}
        onCommit={commitTextEdit}
        onDeleteText={deleteText}
        onDuplicateText={duplicateText}
        onEditingChange={onTextEditingChange}
        onLiveContent={setLiveTextDraft}
      />
    </div>
  );
}
