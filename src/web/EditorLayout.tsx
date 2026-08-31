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
import { WorkspaceNav } from './WorkspaceNav';
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
import { IconBack, IconMoon, IconPdf, IconStock, IconSun } from './chromeIcons';
import { useChromeTheme } from './useChromeTheme';
import { PdfDrawerResizeHandle } from './SplitHandle';
import {
  clampPdfDrawerHeight,
  clampPdfDrawerWidth,
  nextPdfDrawerHeight,
  nextPdfDrawerWidth,
  PDF_DRAWER_BOTTOM_GAP_PX,
  PDF_DRAWER_TOP_PX,
} from '@/src/domain/uiLayout';

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
  return '未保存';
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

  const clearPageInkNow = useCallback(
    (pageId: PageId) => {
      clearPageInk(pageId);
      setPageDelete(null);
    },
    [clearPageInk],
  );

  const confirmEmptyTrash = useCallback(() => {
    if (doc.trash.length === 0) {
      return;
    }
    if (!window.confirm('ゴミ箱を空にしますか？ページは完全に削除されます。')) {
      return;
    }
    dispatch({ type: 'emptyTrash' });
  }, [dispatch, doc.trash.length]);

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

  const handleLiveContent = useCallback(
    (draft: string | null) => {
      setLiveTextDraft(draft);
      onTextDraftChange(draft);
    },
    [onTextDraftChange],
  );

  const stockVisible = stockOpen || Boolean(workspaceGrab);
  const pdfVisible = doc.pdfViewerVisible;
  const bodyRef = useRef<HTMLDivElement>(null);
  const saveKind =
    autosaveStatus.encodingCount > 0 ? 'encoding' : autosaveStatus.unsaved ? 'unsaved' : 'idle';

  const handlePdfDrawerResize = useCallback(
    (deltaX: number, deltaY: number) => {
      const body = bodyRef.current;
      if (!body) {
        return;
      }
      const patch: {
        pdfDrawerWidth?: number;
        pdfDrawerHeight?: number;
      } = {};
      if (deltaX !== 0) {
        patch.pdfDrawerWidth = nextPdfDrawerWidth(
          clampPdfDrawerWidth(doc.pdfDrawerWidth),
          deltaX,
          body.clientWidth,
        );
      }
      if (deltaY !== 0) {
        patch.pdfDrawerHeight = nextPdfDrawerHeight(
          clampPdfDrawerHeight(doc.pdfDrawerHeight),
          deltaY,
          body.clientHeight - PDF_DRAWER_TOP_PX - PDF_DRAWER_BOTTOM_GAP_PX,
        );
      }
      if (patch.pdfDrawerWidth !== undefined || patch.pdfDrawerHeight !== undefined) {
        dispatch({ type: 'setUiLayout', ...patch });
      }
    },
    [dispatch, doc.pdfDrawerHeight, doc.pdfDrawerWidth],
  );

  return (
    <div
      ref={bodyRef}
      className={styles.body}
      data-ms-shell="body"
      data-ms-theme={theme}
      data-ms-pdf={pdfVisible ? 'open' : 'closed'}
      data-ms-stock={stockVisible ? 'open' : 'closed'}
      style={{
        ['--ms-background' as string]: colors.background,
        ['--ms-pdf-drawer-w' as string]: String(clampPdfDrawerWidth(doc.pdfDrawerWidth)),
        ['--ms-pdf-drawer-h' as string]: String(clampPdfDrawerHeight(doc.pdfDrawerHeight)),
      }}
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
              onClearPageInk={clearPageInkNow}
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
          leading={<WorkspaceNav doc={doc} dispatch={dispatch} />}
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
              ) : (
                <button
                  type="button"
                  className={styles.stockSegButton}
                  aria-label="ゴミ箱を空にする"
                  disabled={doc.trash.length === 0}
                  onClick={confirmEmptyTrash}
                >
                  空にする
                </button>
              )}
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
          <PdfDrawerResizeHandle edge="w" onDrag={handlePdfDrawerResize} />
          <PdfDrawerResizeHandle edge="s" onDrag={handlePdfDrawerResize} />
          <PdfDrawerResizeHandle edge="sw" onDrag={handlePdfDrawerResize} />
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
      {saveKind !== 'idle' ? (
        <div
          className={styles.saveStatusCorner}
          data-ms-save={saveKind}
          aria-live="polite"
        >
          <span
            className={`${styles.saveStatusDot} ${
              autosaveStatus.encodingCount > 0
                ? styles.saveStatusEncoding
                : styles.saveStatusUnsaved
            }`}
            aria-hidden
          />
          <span className={styles.saveStatusLabel}>{saveStatusLabel(autosaveStatus)}</span>
        </div>
      ) : null}
    </div>
  );
}
