import { dropActions } from '../../domain/drop';
import type { EditorDocumentAction } from '../../domain/editorReducer';
import type { PageId } from '../../domain/types';

export function moveWorkspacePageToStock(
  pageId: PageId,
  fromIndex: number,
  x: number,
  y: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'workspacePage', pageId, fromIndex },
    { zone: 'stock', x, y },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}

export function returnStockPageToWorkspace(
  pageId: PageId,
  readingIndex: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'stockPage', pageId },
    { zone: 'workspaceInsert', readingIndex },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}

export function placeStockPage(
  pageId: PageId,
  x: number,
  y: number,
  rasterWidth: number,
  rasterHeight: number,
): EditorDocumentAction[] {
  return dropActions(
    { type: 'stockPage', pageId },
    { zone: 'stock', x, y },
    rasterWidth,
    rasterHeight,
  ) as EditorDocumentAction[];
}