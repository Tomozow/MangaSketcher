'use client';

import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageId } from '@/src/domain/types';
import { selectedTextIdsOf } from '@/src/domain/text';
import { selectTargetFlagsOf } from '@/src/domain/types';
import { withoutStockedClips, withoutStockedTexts, stockGridFitPageUnits } from '@/src/domain/stockItems';
import { moveWorkspacePageToStock, nextFreeStockPagePosition } from '@/src/web/stock/stockActions';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import type { EditorDocument, EditorHistory } from '@/src/storage/types';
import type { AutosaveStatus } from '@/src/storage/autosave';
import type { WorkspaceEffect } from '@/src/web/gestures';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import type { MarqueePreview, LassoPreview, ClipLiveTransform, TextLiveTransform } from '@/src/web/useEditorController';
import { colors } from '@/src/theme/tokens';
import { styles } from './editorStyles';
import { CompactSidebar } from './CompactSidebar';
import { WorkspaceNav } from './WorkspaceNav';
import { PdfPanePlaceholder } from './PdfPanePlaceholder';
import { StockPane, STOCK_TRASH_DROP_ATTR } from './StockPane';
import { reduceWorkspaceGrab, type WorkspaceGrab } from './workspaceGrab';
import { PageInkOverlay } from './PageInkOverlay';
import { TextEditBar } from './TextEditBar';
import type { TextEditSelection } from '@/src/web/TextEditBar';
import type { PdfExtractPayload } from '@/src/web/pdf/PdfPageViewer';
import { WorkspaceExportControls } from './WorkspaceExportControls';
import { AppSettingsMenu } from './AppSettingsMenu';
import { WorkspaceLayoutMenu } from './WorkspaceLayoutMenu';
import { WorkspaceStrip } from './WorkspaceStrip';
import { navigateHomeAfterCheckpoint } from './editorNavigate';
import { hardNavigate } from './hardNavigate';
import { IconBack, IconMoon, IconPdf, IconStock, IconSun } from './chromeIcons';
import { useChromeTheme } from './useChromeTheme';
import { useAppSettings } from './useAppSettings';
import { PdfDrawerResizeHandle } from './SplitHandle';
import {
  clampPdfDrawerHeight,
  clampPdfDrawerWidth,
  nextPdfDrawerHeight,
  nextPdfDrawerWidth,
  PDF_DRAWER_BOTTOM_GAP_PX,
  PDF_DRAWER_TOP_PX,
} from '@/src/domain/uiLayout';
import {
  STOCK_EDGE_REVEAL_HOLD_MS,
  shouldRevealStockAtDockEdge,
} from '@/src/web/stock/stockEdgeReveal';

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
  marqueePreview: MarqueePreview | null;
  lassoPreview: LassoPreview | null;
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
  marqueePreview,
  lassoPreview,
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
  const [appSettings, updateAppSettings] = useAppSettings();
  const [workspaceGrab, setWorkspaceGrab] = useState<WorkspaceGrab | null>(null);
  const suppressTrashToggleRef = useRef(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [stockEdgeReveal, setStockEdgeReveal] = useState(false);
  const stockEdgeRevealRef = useRef(false);
  const stockEdgeHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  stockEdgeRevealRef.current = stockEdgeReveal;
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
      dispatch({
        type: source === 'stock' ? 'deleteStockPage' : 'deleteWorkspacePage',
        pageId,
      });
      setPageDelete(null);
    },
    [dispatch],
  );

  const movePageToStockNow = useCallback(
    (pageId: PageId) => {
      const fromIndex = doc.workspaceOrder.indexOf(pageId);
      if (fromIndex < 0) {
        return;
      }
      const { x, y } = nextFreeStockPagePosition(doc.stock);
      for (const action of moveWorkspacePageToStock(
        pageId,
        fromIndex,
        x,
        y,
        doc.rasterWidth,
        doc.rasterHeight,
      )) {
        dispatch(action);
      }
      if (doc.stockPane === 'trash') {
        dispatch({ type: 'setUiLayout', stockPane: 'stock' });
      }
      setStockOpen(true);
      setPageDelete(null);
    },
    [dispatch, doc.rasterHeight, doc.rasterWidth, doc.stock, doc.stockPane, doc.workspaceOrder],
  );

  const clearPageInkNow = useCallback(
    (pageId: PageId) => {
      clearPageInk(pageId);
      setPageDelete(null);
    },
    [clearPageInk],
  );

  const confirmEmptyTrash = useCallback(() => {
    const trashCount =
      doc.trash.length + (doc.trashClips ?? []).length + (doc.trashTexts ?? []).length;
    if (trashCount === 0) {
      return;
    }
    if (!window.confirm('ゴミ箱を空にしますか？ページやアイテムは完全に削除されます。')) {
      return;
    }
    dispatch({ type: 'emptyTrash' });
  }, [dispatch, doc.trash.length, doc.trashClips, doc.trashTexts]);

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
    const clearHideTimer = () => {
      if (stockEdgeHideTimerRef.current != null) {
        clearTimeout(stockEdgeHideTimerRef.current);
        stockEdgeHideTimerRef.current = null;
      }
    };

    if (workspaceGrab) {
      clearHideTimer();
      if (!appSettings.stockRevealOnBottomEdge) {
        setStockEdgeReveal(false);
        return;
      }
      const onMove = (event: PointerEvent) => {
        if (
          shouldRevealStockAtDockEdge(
            event.clientY,
            window.innerHeight,
            appSettings.swapTopbarAndStock ? 'top' : 'bottom',
          )
        ) {
          setStockEdgeReveal(true);
        }
      };
      document.addEventListener('pointermove', onMove);
      return () => document.removeEventListener('pointermove', onMove);
    }

    if (!stockEdgeRevealRef.current) {
      return;
    }
    if (!appSettings.stockHideAfterEdgeDrop) {
      setStockOpen(true);
      setStockEdgeReveal(false);
      return;
    }
    stockEdgeHideTimerRef.current = setTimeout(() => {
      stockEdgeHideTimerRef.current = null;
      setStockEdgeReveal(false);
    }, STOCK_EDGE_REVEAL_HOLD_MS);
    return () => clearHideTimer();
  }, [
    workspaceGrab,
    appSettings.stockRevealOnBottomEdge,
    appSettings.stockHideAfterEdgeDrop,
    appSettings.swapTopbarAndStock,
  ]);

  const handleWorkspaceEffects = useCallback(
    (
      effects: WorkspaceEffect[],
      fingerPositions: Map<number, { x: number; y: number }>,
      surfaceRect: DOMRect | null,
    ) => {
      setWorkspaceGrab((prev) => reduceWorkspaceGrab(prev, effects));
      for (const effect of effects) {
        if (effect.type === 'grabPage') {
          setPageDelete(null);
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
      onTextDraftChange(draft);
    },
    [onTextDraftChange],
  );

  const stockVisible = stockOpen || stockEdgeReveal;
  const pdfVisible = doc.pdfViewerVisible;
  const stockFitItems =
    doc.stockPane === 'trash'
      ? [
          ...doc.trash.map((pageId) => ({ pageId, x: 0, y: 0 })),
          ...(doc.trashClips ?? []).map((clipId) => ({ kind: 'clip' as const, clipId, x: 0, y: 0 })),
          ...(doc.trashTexts ?? []).map((textId) => ({ kind: 'text' as const, textId, x: 0, y: 0 })),
        ]
      : doc.stock;
  const stockFitUnits = Math.max(3, stockGridFitPageUnits(stockFitItems));
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
          appSettings.chromeFlip ? 'left' : 'right',
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
    [dispatch, doc.pdfDrawerHeight, doc.pdfDrawerWidth, appSettings.chromeFlip],
  );

  return (
    <div
      ref={bodyRef}
      className={styles.body}
      data-ms-shell="body"
      data-ms-theme={theme}
      data-ms-pdf={pdfVisible ? 'open' : 'closed'}
      data-ms-stock={stockVisible ? 'open' : 'closed'}
      data-ms-chrome-flip={appSettings.chromeFlip ? '1' : '0'}
      data-ms-stock-top={appSettings.swapTopbarAndStock ? '1' : '0'}
      data-ms-stock-fit={stockVisible && (doc.stockPane === 'trash' || doc.stockLayout === 'grid') ? '1' : '0'}
      style={{
        ['--ms-background' as string]: colors.background,
        ['--ms-pdf-drawer-w' as string]: String(clampPdfDrawerWidth(doc.pdfDrawerWidth)),
        ['--ms-pdf-drawer-h' as string]: String(clampPdfDrawerHeight(doc.pdfDrawerHeight)),
        ['--ms-page-aspect' as string]: String(
          doc.rasterWidth > 0 ? doc.rasterHeight / doc.rasterWidth : 1.41667,
        ),
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
              pasteboardClips={withoutStockedClips(doc.pasteboardClips, doc.stock, doc.trashClips)}
              clipLiveTransforms={clipLiveTransforms}
              pasteboardTexts={withoutStockedTexts(
                doc.pasteboardTexts,
                doc.stock,
                doc.trashTexts,
                doc.trashClipAttachedTexts,
              )}
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
              onDeleteText={deleteText}
              onDuplicateText={duplicateText}
              onConfirmText={() => dispatch({ type: 'selectText', textId: null })}
              inkEngine={inkEngine}
              inkFrame={inkFrame}
              deletePageId={pageDelete?.source === 'workspace' ? pageDelete.pageId : null}
              onDeletePage={(pageId) => confirmPageDelete(pageId, 'workspace')}
              onInsertPage={insertPageAfter}
              onMovePageToStock={movePageToStockNow}
              onClearPageInk={clearPageInkNow}
            />
            {inkEngine ? (
              <PageInkOverlay
                doc={doc}
                engine={inkEngine}
                marqueePreview={marqueePreview}
                lassoPreview={lassoPreview}
                clipLiveTransforms={clipLiveTransforms}
                textLiveTransforms={textLiveTransforms}
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
        <AppSettingsMenu settings={appSettings} onChange={updateAppSettings} />
        {appSettings.stockPdfButtonsOnPalette ? null : (
          <>
            <button
              type="button"
              className={`${styles.chromeIcon} ${stockOpen ? styles.chromeIconPressed : ''}`}
              aria-label="ストック"
              aria-pressed={stockOpen}
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
          </>
        )}
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
          shortcuts={appSettings.shortcuts}
          toolFlyoutOnFirstTap={appSettings.toolFlyoutOnFirstTap}
          leading={
            appSettings.navBarVisible ? (
              <WorkspaceNav doc={doc} dispatch={dispatch} pageTurnUnit={appSettings.pageTurnUnit} />
            ) : undefined
          }
          trailing={
            appSettings.stockPdfButtonsOnPalette ? (
              <div className={styles.toolRail} role="toolbar" aria-label="ストックとPDF">
                <button
                  type="button"
                  className={`${styles.chromeIcon} ${stockOpen ? styles.chromeIconPressed : ''}`}
                  aria-label="ストック"
                  aria-pressed={stockOpen}
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
              </div>
            ) : undefined
          }
        />
      </div>

      {stockVisible ? (
        <div
          id="editor-sidebar-split"
          className={styles.stockDock}
          data-ms-shell="pane"
          data-ms-region="stock"
          style={{ ['--ms-stock-fit-units' as string]: String(stockFitUnits) }}
        >
          <aside className={styles.stockSheet} aria-label="ストック">
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
          <div className={styles.stockDrawerHead}>
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
                  className={`${styles.stockSegButton} ${styles.stockSegButtonDanger}`}
                  aria-label="ゴミ箱を空にする"
                  disabled={
                    doc.trash.length === 0 &&
                    (doc.trashClips ?? []).length === 0 &&
                    (doc.trashTexts ?? []).length === 0
                  }
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
        </div>
      ) : null}

      {pdfVisible ? (
        <aside
          className={styles.pdfDrawer}
          data-ms-shell="pane"
          data-ms-region="pdf"
          aria-label="PDF"
        >
          {appSettings.chromeFlip ? (
            <>
              <PdfDrawerResizeHandle edge="e" onDrag={handlePdfDrawerResize} />
              <PdfDrawerResizeHandle edge="s" onDrag={handlePdfDrawerResize} />
              <PdfDrawerResizeHandle edge="se" onDrag={handlePdfDrawerResize} />
            </>
          ) : (
            <>
              <PdfDrawerResizeHandle edge="w" onDrag={handlePdfDrawerResize} />
              <PdfDrawerResizeHandle edge="s" onDrag={handlePdfDrawerResize} />
              <PdfDrawerResizeHandle edge="sw" onDrag={handlePdfDrawerResize} />
            </>
          )}
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
                    extractSanitizePunctuation: doc.pdf.extractSanitizePunctuation,
                  }
                : null
            }
            onViewChange={onPdfViewChange}
            onPickPdf={onPickPdf}
            onExtractText={onExtractPdfText}
            onToggleExtractSanitizePunctuation={(enabled) =>
              dispatch({ type: 'setPdfExtractSanitizePunctuation', enabled })
            }
          />
        </aside>
      ) : null}

      <TextEditBar
        selection={
          doc.tool === 'text' && selectedTextIdsOf(doc).length <= 1 ? textSelection : null
        }
        layoutKey={`${doc.workspaceZoom}:${doc.workspacePanX}:${doc.workspacePanY}:${
          textSelection ? JSON.stringify(textLiveTransforms[textSelection.id] ?? null) : ''
        }`}
        onCommit={commitTextEdit}
        onDeleteText={deleteText}
        onDuplicateText={duplicateText}
        onFinish={() => dispatch({ type: 'selectText', textId: null })}
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
