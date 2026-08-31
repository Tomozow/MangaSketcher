'use client';

import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import { buildStripFrames, stripLayoutFromDoc } from '@/src/domain/stripGeometry';
import {
  neighborWorkspacePageId,
  panViewToWorldRect,
  WORKSPACE_MAX_ZOOM,
  WORKSPACE_MIN_ZOOM,
  WORKSPACE_ZOOM_STEP,
  zoomViewAroundPivot,
  type WorkspaceView,
} from '@/src/domain/workspaceView';
import type { EditorDocument } from '@/src/storage/types';
import {
  IconPageNext,
  IconPagePrev,
  IconZoomIn,
  IconZoomOut,
} from './chromeIcons';
import { styles } from './editorStyles';

type WorkspaceNavProps = {
  doc: EditorDocument;
  dispatch: (action: EditorDocumentAction) => void;
};

function workspacePaneSize(): { width: number; height: number } {
  const pane = document.getElementById('editor-workspace-pane');
  return {
    width: Math.max(1, pane?.clientWidth ?? 800),
    height: Math.max(1, pane?.clientHeight ?? 600),
  };
}

function currentView(doc: EditorDocument): WorkspaceView {
  return {
    zoom: doc.workspaceZoom,
    panX: doc.workspacePanX,
    panY: doc.workspacePanY,
  };
}

export function WorkspaceNav({ doc, dispatch }: WorkspaceNavProps) {
  const pageCount = doc.workspaceOrder.length;
  const selectedIndex = doc.selectedPageId ? doc.workspaceOrder.indexOf(doc.selectedPageId) : -1;
  const pageLabel = selectedIndex >= 0 ? `${selectedIndex + 1} / ${pageCount}` : `— / ${pageCount}`;
  const prevPageId = neighborWorkspacePageId(doc.workspaceOrder, doc.selectedPageId, -1);
  const nextPageId = neighborWorkspacePageId(doc.workspaceOrder, doc.selectedPageId, 1);

  const applyView = (view: WorkspaceView) => {
    if (
      view.zoom === doc.workspaceZoom &&
      view.panX === doc.workspacePanX &&
      view.panY === doc.workspacePanY
    ) {
      return;
    }
    dispatch({ type: 'setWorkspaceView', zoom: view.zoom, panX: view.panX, panY: view.panY });
  };

  const nudgeZoom = (direction: 1 | -1) => {
    const viewport = workspacePaneSize();
    applyView(
      zoomViewAroundPivot(
        currentView(doc),
        direction > 0 ? WORKSPACE_ZOOM_STEP : 1 / WORKSPACE_ZOOM_STEP,
        viewport.width / 2,
        viewport.height / 2,
      ),
    );
  };

  const goPage = (pageId: string) => {
    dispatch({ type: 'selectPage', pageId });
    const frame = buildStripFrames(doc.workspaceOrder, stripLayoutFromDoc(doc)).frames.find(
      (item) => item.slot.kind === 'page' && item.slot.pageId === pageId,
    );
    if (!frame) {
      return;
    }
    applyView(panViewToWorldRect(currentView(doc), frame, workspacePaneSize()));
  };

  return (
    <div className={styles.workspaceNav} role="toolbar" aria-label="表示">
      <button
        type="button"
        className={styles.chromeIcon}
        aria-label="ズームイン"
        title="ズームイン"
        onClick={() => nudgeZoom(1)}
        disabled={doc.workspaceZoom >= WORKSPACE_MAX_ZOOM}
      >
        <IconZoomIn />
      </button>
      <span className={styles.workspaceNavLabel}>{Math.round(doc.workspaceZoom * 100)}%</span>
      <button
        type="button"
        className={styles.chromeIcon}
        aria-label="ズームアウト"
        title="ズームアウト"
        onClick={() => nudgeZoom(-1)}
        disabled={doc.workspaceZoom <= WORKSPACE_MIN_ZOOM}
      >
        <IconZoomOut />
      </button>
      <hr className={styles.toolRailRule} />
      <button
        type="button"
        className={styles.chromeIcon}
        aria-label="前のページ"
        title="前のページ"
        onClick={() => prevPageId && goPage(prevPageId)}
        disabled={prevPageId == null}
      >
        <IconPagePrev />
      </button>
      <span className={styles.workspaceNavLabel}>{pageLabel}</span>
      <button
        type="button"
        className={styles.chromeIcon}
        aria-label="次のページ"
        title="次のページ"
        onClick={() => nextPageId && goPage(nextPageId)}
        disabled={nextPageId == null}
      >
        <IconPageNext />
      </button>
    </div>
  );
}
