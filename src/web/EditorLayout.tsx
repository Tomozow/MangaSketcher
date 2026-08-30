'use client';

import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageId } from '@/src/domain/types';
import { selectTargetFlagsOf } from '@/src/domain/types';
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
import { StockPane, STOCK_TRASH_DROP_ATTR, type WorkspaceGrab } from './StockPane';
import { PageInkOverlay } from './PageInkOverlay';
import { TextEditBar } from './TextEditBar';
import type { TextEditSelection } from '@/src/web/TextEditBar';
import type { PdfExtractPayload } from '@/src/web/pdf/PdfPageViewer';
import { WorkspaceExportControls } from './WorkspaceExportControls';
import { WorkspaceLayoutMenu } from './WorkspaceLayoutMenu';
import { WorkspaceStrip } from './WorkspaceStrip';
import { navigateHomeAfterCheckpoint } from './editorNavigate';
import { hardNavigate } from './hardNavigate';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';
import { IconBack, IconMoon, IconPdf, IconStock, IconSun } from './chromeIcons';
import { useChromeTheme } from './useChromeTheme';

// #region agent log
const AGENT_DEBUG_INGEST = 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426';
let layoutLiveDebugCount = 0;
// #endregion

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
  deleteClip: (clipId: string) => void;
  duplicateClip: (clipId: string) => void;
  insertClipOnPage: (clipId: string) => void;
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
  onExtractPdfText: (payload: PdfExtractPayload) => void;
  inkEngine: InkEngine | null;
  inkFrame: number;
  rasterLayoutGen: number;
  marqueePreview: MarqueePreview | null;
  clipLiveTransforms: Readonly<Record<string, ClipLiveTransform>>;
  textLiveTransforms: Readonly<Record<string, TextLiveTransform>>;
  autosaveStatus: AutosaveStatus;
  getPageThumb: (pageId: PageId) => ImageBitmap | undefined;
  getClipRasterSize: (clipId: string) => { width: number; height: number };
  clearPageInk: (pageId: PageId) => void;
  onNavigateHome: () => Promise<void>;
  onTextDraftChange: (draft: string | null) => void;
};

function saveStatusLabel(status: AutosaveStatus): string {
  if (status.encodingCount > 0) {
    return 'エンコード中';
  }
  if (status.unsaved) {
    return '未保存';
  }
  return '保存済み';
}

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
  deleteClip,
  duplicateClip,
  insertClipOnPage,
  onTextEditingChange,
  onUndo,
  onRedo,
  pdfBytes,
  onPdfViewChange,
  onPickPdf,
  onExtractPdfText,
  inkEngine,
  inkFrame,
  rasterLayoutGen,
  marqueePreview,
  clipLiveTransforms,
  textLiveTransforms,
  autosaveStatus,
  getPageThumb,
  getClipRasterSize,
  clearPageInk,
  onNavigateHome,
  onTextDraftChange,
}: EditorLayoutProps) {
  const { theme, toggleTheme } = useChromeTheme();
  const [workspaceGrab, setWorkspaceGrab] = useState<WorkspaceGrab | null>(null);
  const suppressTrashToggleRef = useRef(false);
  const [liveTextDraft, setLiveTextDraft] = useState<string | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const [pageDelete, setPageDelete] = useState<{ pageId: PageId; source: 'workspace' | 'stock' } | null>(
    null,
  );

  const insertPageAfter = useCallback(
    (pageId: PageId) => {
      if (doc.selectedPageId !== pageId) {
        dispatch({ type: 'selectPage', pageId });
      }
      dispatch({ type: 'insertAfterSelected' });
      setPageDelete(null);
    },
    [dispatch, doc.selectedPageId],
  );

  const confirmPageDelete = useCallback(
    (pageId: PageId, source: 'workspace' | 'stock') => {
      if (!window.confirm('このページをゴミ箱に移しますか？')) {
        return;
      }
      dispatch({
        type: source === 'stock' ? 'deleteStockPage' : 'deleteWorkspacePage',
        pageId,
      });
      setPageDelete(null);
    },
    [dispatch],
  );

  const confirmClearPageInk = useCallback(
    (pageId: PageId) => {
      if (!window.confirm('このページの線画を削除しますか？')) {
        return;
      }
      clearPageInk(pageId);
      setPageDelete(null);
    },
    [clearPageInk],
  );

  useEffect(() => {
    if (!pageDelete) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element) {
        if (event.target.closest('[data-page-delete-chrome]')) {
          return;
        }
        if (event.target.closest('[data-page-number-band]')) {
          return;
        }
      }
      setPageDelete(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [pageDelete]);

  useEffect(() => {
    if (workspaceGrab) {
      setStockOpen(true);
    }
  }, [workspaceGrab]);

  const handleWorkspaceEffects = useCallback(
    (
      effects: WorkspaceEffect[],
      fingerPositions: Map<number, { x: number; y: number }>,
      surfaceRect: DOMRect | null,
    ) => {
      for (const effect of effects) {
        if (effect.type === 'grabPage') {
          setWorkspaceGrab({ pageId: effect.pageId, fromIndex: effect.fromIndex });
          setPageDelete(null);
        }
        if (effect.type === 'endGrabPage') {
          setWorkspaceGrab(null);
        }
        if (effect.type === 'showPageDelete') {
          setPageDelete({ pageId: effect.pageId, source: 'workspace' });
        }
      }
      return applyWorkspaceEffects(effects, fingerPositions, surfaceRect);
    },
    [applyWorkspaceEffects],
  );

  const handleNavigateHome = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      void navigateHomeAfterCheckpoint(onNavigateHome, (path) => hardNavigate(path));
    },
    [onNavigateHome],
  );

  const liveTextDraftRef = useRef(liveTextDraft);
  liveTextDraftRef.current = liveTextDraft;
  const handleLiveContent = useCallback(
    (draft: string | null) => {
      // #region agent log
      if (layoutLiveDebugCount < 12) {
        layoutLiveDebugCount += 1;
        const prevDraft = liveTextDraftRef.current;
        ipadDebugLog({
          sessionId: '183625',
          ingest: AGENT_DEBUG_INGEST,
          runId: 'pre-fix',
          hypothesisId: 'E',
          location: 'EditorLayout.tsx:onLiveContent',
          message: 'onLiveContent',
          data: {
            n: layoutLiveDebugCount,
            next: draft === null ? 'null' : `len:${draft.length}`,
            prev: prevDraft === null ? 'null' : `len:${prevDraft.length}`,
            same: prevDraft === draft,
          },
          timestamp: Date.now(),
        });
      }
      // #endregion
      setLiveTextDraft(draft);
      onTextDraftChange(draft);
    },
    [onTextDraftChange],
  );

  const stockVisible = stockOpen || Boolean(workspaceGrab);
  const pdfVisible = doc.pdfViewerVisible;
  const saveKind =
    autosaveStatus.encodingCount > 0 ? 'encoding' : autosaveStatus.unsaved ? 'unsaved' : 'idle';

  return (
    <div
      className={styles.body}
      data-ms-shell="body"
      data-ms-theme={theme}
      data-ms-pdf={pdfVisible ? 'open' : 'closed'}
      data-ms-stock={stockVisible ? 'open' : 'closed'}
      style={{ ['--ms-background' as string]: colors.background }}
    >
      <div id="editor-main-split" className={styles.mainColumn}>
        <div className={styles.splitRow} data-ms-shell="split-row">
          <div
            id="editor-workspace-pane"
            className={styles.pane}
            data-ms-shell="pane"
            data-ms-region="workspace"
            aria-label="ワークスペース"
            style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}
          >
            <WorkspaceStrip
              workspaceOrder={doc.workspaceOrder}
              pages={doc.pages}
              pasteboardClips={doc.pasteboardClips}
              clipLiveTransforms={clipLiveTransforms}
              pasteboardTexts={doc.pasteboardTexts}
              selectedPageId={doc.selectedPageId}
              selectedClipId={doc.selectedClipId}
              selectedClipIds={doc.selectedClipIds}
              tool={doc.tool}
              zoom={doc.workspaceZoom}
              panX={doc.workspacePanX}
              panY={doc.workspacePanY}
              rasterWidth={doc.rasterWidth}
              rasterHeight={doc.rasterHeight}
              getClipRasterSize={getClipRasterSize}
              stripLayout={doc}
              applyWorkspaceEffects={handleWorkspaceEffects}
              getPageThumb={getPageThumb}
              selectedTextId={doc.selectedTextId}
              selectedTextIds={doc.selectedTextIds}
              selectTargets={selectTargetFlagsOf(doc.tools)}
              textLiveTransforms={textLiveTransforms}
              liveTextContent={
                doc.tool === 'text' && textSelection && liveTextDraft !== null
                  ? { id: textSelection.id, content: liveTextDraft }
                  : null
              }
              onDeleteText={deleteText}
              onDuplicateText={duplicateText}
              inkEngine={inkEngine}
              inkFrame={inkFrame}
              deletePageId={pageDelete?.source === 'workspace' ? pageDelete.pageId : null}
              onDeletePage={(pageId) => confirmPageDelete(pageId, 'workspace')}
              onInsertPage={insertPageAfter}
              onClearPageInk={confirmClearPageInk}
            />
            {inkEngine ? (
              <PageInkOverlay
                doc={doc}
                engine={inkEngine}
                inkFrame={inkFrame}
                marqueePreview={marqueePreview}
                clipLiveTransforms={clipLiveTransforms}
                onDeleteClip={deleteClip}
                onDuplicateClip={duplicateClip}
                onInsertClip={insertClipOnPage}
              />
            ) : null}
          </div>
        </div>
      </div>

      <header className={styles.topbar} data-ms-shell="nav">
        <a href="/" className={styles.chromeIcon} onClick={handleNavigateHome} aria-label="一覧へ" title="一覧へ">
          <IconBack />
        </a>
        <div className={styles.topbarTitle}>
          <h1 className={styles.headerTitle}>{doc.name}</h1>
          <div
            className={styles.topbarTitleMeta}
            data-ms-save={saveKind}
            aria-live="polite"
          >
            <span
              className={`${styles.saveStatusDot} ${
                autosaveStatus.encodingCount > 0
                  ? styles.saveStatusEncoding
                  : autosaveStatus.unsaved
                    ? styles.saveStatusUnsaved
                    : styles.saveStatusIdle
              }`}
              aria-hidden
            />
            <span className={styles.saveStatusLabel}>{saveStatusLabel(autosaveStatus)}</span>
          </div>
        </div>
        <WorkspaceLayoutMenu doc={doc} dispatch={dispatch} />
        <button
          type="button"
          className={`${styles.chromeIcon} ${stockVisible ? styles.chromeIconPressed : ''}`}
          aria-label="ストック"
          aria-pressed={stockVisible}
          title="ストック"
          onClick={() => setStockOpen((open) => !open)}
        >
          <IconStock />
        </button>
        <button
          type="button"
          className={`${styles.chromeIcon} ${pdfVisible ? styles.chromeIconPressed : ''}`}
          aria-label="PDF 表示切替"
          aria-pressed={pdfVisible}
          title="PDF"
          onClick={() => dispatch({ type: 'setUiLayout', pdfViewerVisible: !doc.pdfViewerVisible })}
        >
          <IconPdf />
        </button>
        <WorkspaceExportControls
          doc={doc}
          inkEngine={inkEngine}
          onBeforeExport={onNavigateHome}
        />
        <button
          type="button"
          className={styles.chromeIcon}
          aria-label="明るい／暗いUI"
          title="明るい／暗いUI"
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </header>

      <div className={styles.toolsOverlay} data-ms-shell="pane" data-ms-region="tools" aria-label="ツール">
        <CompactSidebar
          doc={doc}
          history={history}
          textEditing={textEditing}
          dispatch={dispatch}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      </div>

      {stockVisible ? (
        <aside
          id="editor-sidebar-split"
          className={styles.stockSheet}
          data-ms-shell="pane"
          data-ms-region="stock"
          aria-label="ストック"
        >
          <div className={styles.stockDrawerHead}>
            <strong>{doc.stockPane === 'trash' ? 'ゴミ箱' : 'ストック'}</strong>
            <div className={styles.stockSeg} role="group" aria-label="ストック表示">
              {doc.stockPane !== 'trash' ? (
                <>
                  <button
                    type="button"
                    className={`${styles.stockSegButton} ${doc.stockLayout === 'grid' ? styles.chromeIconPressed : ''}`}
                    aria-pressed={doc.stockLayout === 'grid'}
                    aria-label="ストックを整列"
                    onClick={() => dispatch({ type: 'setUiLayout', stockLayout: 'grid' })}
                  >
                    整列
                  </button>
                  <button
                    type="button"
                    className={`${styles.stockSegButton} ${doc.stockLayout === 'free' ? styles.chromeIconPressed : ''}`}
                    aria-pressed={doc.stockLayout === 'free'}
                    aria-label="ストックを自由配置"
                    onClick={() => dispatch({ type: 'setUiLayout', stockLayout: 'free' })}
                  >
                    自由
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className={`${styles.stockSegButton} ${doc.stockPane === 'trash' ? styles.chromeIconPressed : ''}`}
                aria-pressed={doc.stockPane === 'trash'}
                aria-label="ゴミ箱"
                {...{ [STOCK_TRASH_DROP_ATTR]: '' }}
                onClick={() => {
                  if (suppressTrashToggleRef.current) {
                    suppressTrashToggleRef.current = false;
                    return;
                  }
                  dispatch({
                    type: 'setUiLayout',
                    stockPane: doc.stockPane === 'trash' ? 'stock' : 'trash',
                  });
                }}
              >
                ゴミ箱
              </button>
            </div>
          </div>
          <StockPane
            doc={doc}
            dispatch={dispatch}
            workspaceGrab={workspaceGrab}
            onWorkspaceGrabEnd={() => setWorkspaceGrab(null)}
            onDroppedToTrash={() => {
              suppressTrashToggleRef.current = true;
            }}
            getPageThumb={getPageThumb}
            inkEngine={inkEngine}
            rasterLayoutGen={rasterLayoutGen}
            deletePageId={pageDelete?.source === 'stock' ? pageDelete.pageId : null}
            onShowPageDelete={(pageId) => {
              if (!pageId) {
                setPageDelete(null);
                return;
              }
              setPageDelete({ pageId, source: 'stock' });
            }}
            onDeletePage={(pageId) => confirmPageDelete(pageId, 'stock')}
          />
        </aside>
      ) : null}

      {pdfVisible ? (
        <aside
          className={styles.pdfDrawer}
          data-ms-shell="pane"
          data-ms-region="pdf"
          aria-label="PDF"
        >
          <div className={styles.pdfDrawerHead}>
            <strong>原稿 PDF</strong>
            <span>抽出は範囲ドラッグ</span>
          </div>
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
                    extractedGlyphs: doc.pdf.extractedGlyphs,
                    extractMarkersVisible: doc.pdf.extractMarkersVisible,
                    extractSanitizePunctuation: doc.pdf.extractSanitizePunctuation,
                  }
                : null
            }
            onViewChange={onPdfViewChange}
            onPickPdf={onPickPdf}
            onExtractText={onExtractPdfText}
            onToggleExtractMarkers={(visible) =>
              dispatch({ type: 'setPdfExtractMarkersVisible', visible })
            }
            onToggleExtractSanitizePunctuation={(enabled) =>
              dispatch({ type: 'setPdfExtractSanitizePunctuation', enabled })
            }
          />
        </aside>
      ) : null}

      <TextEditBar
        selection={doc.tool === 'text' ? textSelection : null}
        layoutKey={`${doc.workspaceZoom}:${doc.workspacePanX}:${doc.workspacePanY}:${
          textSelection ? JSON.stringify(textLiveTransforms[textSelection.id] ?? null) : ''
        }`}
        onCommit={commitTextEdit}
        onDeleteText={deleteText}
        onDuplicateText={duplicateText}
        onEditingChange={onTextEditingChange}
        onLiveContent={handleLiveContent}
      />
    </div>
  );
}
