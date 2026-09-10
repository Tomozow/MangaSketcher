import type { EditorDocumentAction } from '../domain/editorReducer';
import { collectRasterIds } from './rasterIds';
import type { EditorDocument } from './types';

function uniqueIds(ids: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function addedRasterIds(prev: EditorDocument, next: EditorDocument): string[] {
  const before = new Set(collectRasterIds(prev));
  return collectRasterIds(next).filter((id) => !before.has(id));
}

/** Rasters whose encoded PNG may have changed. Metadata-only edits return []. */
export function dirtyRasterIdsForAction(
  prev: EditorDocument,
  next: EditorDocument,
  action: EditorDocumentAction,
): string[] {
  const added = addedRasterIds(prev, next);
  switch (action.type) {
    case 'commitMarqueeCut': {
      const page = prev.pages[action.pageId];
      return uniqueIds([page?.rasterId, action.rasterId, ...added]);
    }
    case 'commitClipScissorsCut': {
      const source = prev.pasteboardClips.find((c) => c.id === action.sourceClipId);
      return uniqueIds([source?.rasterId, action.piece.rasterId, ...added]);
    }
    case 'commitClipBake': {
      const page = next.pages[action.pageId];
      return uniqueIds([page?.rasterId, ...added]);
    }
    case 'commitClipMerge':
    case 'duplicateClip':
      return uniqueIds([action.rasterId, ...added]);
    case 'commitInkBake':
      return uniqueIds([action.rasterId, ...added]);
    default:
      return added;
  }
}
