'use client';

import { useCallback, useState } from 'react';
import { mainPaneFlex, nextSplitFromDrag, sidebarPaneFlex } from '@/src/domain/uiLayout';
import type { PageId, Rect } from '@/src/domain/types';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import type { EditorDocument, EditorHistory } from '@/src/storage/types';
import type { AutosaveStatus } from '@/src/storage/autosave';
import type { WorkspaceEffect } from '@/src/web/gestures';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import type { MarqueePreview } from '@/src/web/useEditorController';
import { colors } from '@/src/theme/tokens';
import styles from './editor.module.css';
import { CompactSidebar } from './CompactSidebar';
import { PdfPanePlaceholder } from './PdfPanePlaceholder';
import { SplitHandle } from './SplitHandle';
import { StockPane, type WorkspaceGrab } from './StockPane';
import { PageInkOverlay } from './PageInkOverlay';
import { PageTextOverlay } from './PageTextOverlay';
import { TextEditBar } from './TextEditBar';
import type { TextEditSelection } from '@/src/web/TextEditBar';
import { WorkspaceStrip } from './WorkspaceStrip';

type EditorLayoutProps = {
  doc: EditorDocument;
  history: EditorHistory;
  pdfMissing: boolean;
  textEditing: boolean;
  textSelection: TextEditSelection | null;
  viewportBottom: number;
  dispatch: (action: EditorDocumentAction) => void;
  applyWorkspaceEffects: (
    effects: WorkspaceEffect[],
    fingerPositions: Map<number, { x: number; y: number }>,
    surfaceRect: DOMRect | null,
  ) => string | null | undefined;
  commitTextEdit: (textId: string, content: string) => void;
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
  viewportBottom,
  dispatch,
  applyWorkspaceEffects,
  commitTextEdit,
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
  autosaveStatus,
  getPageThumb,
  getClipRasterSize,
}: EditorLayoutProps) {
  const mainFlex = mainPaneFlex(doc);
  const sideFlex = sidebarPaneFlex(doc);
  const sidebarClass = doc.sidebarCompact ? styles.sidebarCompact : styles.sidebarNormal;
  const [workspaceGrab, setWorkspaceGrab] = useState<WorkspaceGrab | null>(null);

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
    const total = sideEl?.clientHeight ?? 1;
    const next = nextSplitFromDrag(doc.paletteStockSplit, deltaPx, total);
    dispatch({ type: 'setUiLayout', paletteStockSplit: next });
  };

  return (
    <div className={styles.body} style={{ ['--ms-background' as string]: colors.background }}>
      <div id="editor-main-split" className={styles.mainColumn}>
        <div className={styles.splitRow}>
          <div id="editor-workspace-pane" className={styles.pane} style={{ flex: mainFlex.workspace }}>
            <span className={styles.paneLabel}>ワークスペース</span>
            <WorkspaceStrip
              workspaceOrder={doc.workspaceOrder}
              pages={doc.pages}
              pasteboardClips={doc.pasteboardClips}
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
            />
            {inkEngine ? (
              <PageInkOverlay
                doc={doc}
                engine={inkEngine}
                inkFrame={inkFrame}
                marqueePreview={marqueePreview}
              />
            ) : null}
            <PageTextOverlay doc={doc} hidden={textEditing} />
          </div>

          {doc.pdfViewerVisible ? (
            <>
              <SplitHandle orientation="horizontal" onDrag={handleWorkspacePdfDrag} />
              <div className={styles.pane} style={{ flex: mainFlex.pdf }}>
                <span className={styles.paneLabel}>PDF</span>
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

      <div id="editor-sidebar-split" className={`${styles.sidebarColumn} ${sidebarClass}`}>
        <div className={styles.splitCol}>
          <div className={styles.pane} style={{ flex: sideFlex.palette }}>
            <span className={styles.paneLabel}>ツール</span>
            <CompactSidebar
              doc={doc}
              history={history}
              textEditing={textEditing}
              autosaveStatus={autosaveStatus}
              dispatch={dispatch}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          </div>
          <SplitHandle orientation="vertical" onDrag={handlePaletteStockDrag} />
          <div className={styles.pane} style={{ flex: sideFlex.stock }}>
            <span className={styles.paneLabel}>ストック</span>
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
      <TextEditBar
        selection={textSelection}
        viewportBottom={viewportBottom}
        onCommit={commitTextEdit}
        onEditingChange={onTextEditingChange}
      />
    </div>
  );
}
