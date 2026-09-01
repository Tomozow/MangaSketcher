import { withoutStockedClips } from '@/src/domain/stockItems';
import type { EditorDocument } from '@/src/storage/types';

/**
 * Workspace-document rasters (not viewport): pages on the strip plus
 * pasteboard clips that are not stock/trash.
 */
export function visiblePageRasterIds(doc: EditorDocument): string[] {
  const ids: string[] = [];
  for (const pageId of doc.workspaceOrder) {
    const rasterId = doc.pages[pageId]?.rasterId;
    if (rasterId) {
      ids.push(rasterId);
    }
  }
  for (const clip of withoutStockedClips(doc.pasteboardClips, doc.stock, doc.trashClips)) {
    ids.push(clip.rasterId);
  }
  return ids;
}

export function workspaceVisibleRasterIdsKey(doc: EditorDocument): string {
  const workspace = doc.workspaceOrder.map((pageId) => doc.pages[pageId]?.rasterId ?? '');
  const clips = withoutStockedClips(doc.pasteboardClips, doc.stock, doc.trashClips).map(
    (clip) => clip.rasterId,
  );
  return `${workspace.join('\0')}|${clips.join('\0')}`;
}
