import type { DocumentAction } from './reducer';
import { defaultTextBox } from './text';
import type { ClipId, PageId, Rect, TextId } from './types';

export type DragPayload =
  | { type: 'pdfText'; pdfPage: number; range: Rect; preview: string }
  | { type: 'workspacePage'; pageId: PageId; fromIndex: number }
  | { type: 'stockPage'; pageId: PageId }
  | { type: 'trashPage'; pageId: PageId }
  | { type: 'clip'; clipId: ClipId }
  | { type: 'pasteboardText'; textId: TextId };

export type DropTarget =
  | { zone: 'workspaceInsert'; readingIndex: number }
  | { zone: 'stock'; x: number; y: number }
  | { zone: 'page'; pageId: PageId; localX: number; localY: number }
  | { zone: 'pasteboard'; x: number; y: number };

export function dropActions(
  payload: DragPayload,
  target: DropTarget,
  rasterWidth: number,
  rasterHeight: number,
): DocumentAction[] {
  const defaultBox = defaultTextBox(rasterWidth, rasterHeight);
  if (payload.type === 'pdfText') {
    if (target.zone === 'page') {
      return [
        {
          type: 'dropPdfTextRange',
          pdfPage: payload.pdfPage,
          range: payload.range,
          attachment: { kind: 'page', pageId: target.pageId },
          box: {
            x: target.localX,
            y: target.localY,
            width: defaultBox.width,
            height: defaultBox.height,
          },
        },
      ];
    }
    if (target.zone === 'pasteboard' || target.zone === 'workspaceInsert') {
      const x = target.zone === 'pasteboard' ? target.x : 16;
      const y = target.zone === 'pasteboard' ? target.y : 16;
      return [
        {
          type: 'dropPdfTextRange',
          pdfPage: payload.pdfPage,
          range: payload.range,
          attachment: { kind: 'pasteboard' },
          box: { x, y, width: defaultBox.width, height: defaultBox.height },
        },
      ];
    }
    return [];
  }

  if (payload.type === 'workspacePage') {
    if (target.zone === 'stock') {
      return [{ type: 'movePageToStock', pageId: payload.pageId, x: target.x, y: target.y }];
    }
    if (target.zone === 'workspaceInsert') {
      let toIndex = target.readingIndex;
      if (toIndex > payload.fromIndex) {
        toIndex = Math.min(toIndex, toIndex);
      }
      return [{ type: 'reorderWorkspace', fromIndex: payload.fromIndex, toIndex }];
    }
    return [];
  }

  if (payload.type === 'stockPage') {
    if (target.zone === 'workspaceInsert') {
      return [
        { type: 'returnStockToWorkspace', pageId: payload.pageId, readingIndex: target.readingIndex },
      ];
    }
    if (target.zone === 'stock') {
      return [{ type: 'placeStock', pageId: payload.pageId, x: target.x, y: target.y }];
    }
    return [];
  }

  if (payload.type === 'trashPage') {
    if (target.zone === 'workspaceInsert') {
      return [
        { type: 'returnTrashToWorkspace', pageId: payload.pageId, readingIndex: target.readingIndex },
      ];
    }
    return [];
  }

  if (payload.type === 'clip') {
    if (target.zone === 'page') {
      return [
        {
          type: 'bakeClipOntoPage',
          clipId: payload.clipId,
          pageId: target.pageId,
          pageLocalX: target.localX,
          pageLocalY: target.localY,
        },
      ];
    }
    if (target.zone === 'pasteboard' || target.zone === 'workspaceInsert') {
      const x = target.zone === 'pasteboard' ? target.x : 8;
      const y = target.zone === 'pasteboard' ? target.y : 8;
      return [{ type: 'transformClip', clipId: payload.clipId, x, y }];
    }
    return [];
  }

  if (payload.type === 'pasteboardText') {
    if (target.zone === 'page') {
      return [
        {
          type: 'attachTextToPage',
          textId: payload.textId,
          pageId: target.pageId,
          pageBox: {
            x: target.localX,
            y: target.localY,
            width: defaultBox.width,
            height: defaultBox.height,
          },
        },
      ];
    }
    if (target.zone === 'pasteboard' || target.zone === 'workspaceInsert') {
      const x = target.zone === 'pasteboard' ? target.x : 8;
      const y = target.zone === 'pasteboard' ? target.y : 8;
      return [{ type: 'moveText', textId: payload.textId, x, y }];
    }
  }

  return [];
}

export function pageIdFromDrag(payload: DragPayload): PageId | null {
  if (payload.type === 'workspacePage' || payload.type === 'stockPage' || payload.type === 'trashPage') {
    return payload.pageId;
  }
  return null;
}

export function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
}
