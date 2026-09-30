import { ipadDebugLog } from '@/src/web/ipadDebugLog';

/** Rows land in debug/debug-ink-loss.log (dev server only). Kept to low-frequency events. */
export function inkLog(location: string, message: string, data?: Record<string, unknown>): void {
  ipadDebugLog({ sessionId: 'ink-loss', location, message, data });
}

type ClipLike = { id: string; rasterId: string; x: number; y: number; scale: number; scaleY?: number; rotation: number };
type DocLike = {
  pasteboardClips: ClipLike[];
  stock: unknown[];
  trash?: unknown[];
  trashClips?: string[];
  workspaceOrder: string[];
  workspaceZoom?: number;
  workspacePanX?: number;
  workspacePanY?: number;
};

/** Where clips live in the document: visible on the pasteboard, or hidden via stock / trash. */
export function docShape(doc: DocLike, withClips: boolean): Record<string, unknown> {
  const stocked = new Set<string>();
  for (const item of doc.stock as Array<{ kind?: string; clipId?: string }>) {
    if (item?.kind === 'clip' && item.clipId) stocked.add(item.clipId);
  }
  const trashed = new Set(doc.trashClips ?? []);
  const clips = doc.pasteboardClips;
  const shape: Record<string, unknown> = {
    pages: doc.workspaceOrder.length,
    clips: clips.length,
    clipsStocked: clips.filter((c) => stocked.has(c.id)).length,
    clipsTrashed: clips.filter((c) => trashed.has(c.id)).length,
    stock: doc.stock.length,
    trashPages: doc.trash?.length ?? 0,
    view: [doc.workspaceZoom, doc.workspacePanX, doc.workspacePanY],
  };
  if (withClips) {
    shape.clipList = clips.map((c) => [
      c.id.slice(-4),
      Math.round(c.x),
      Math.round(c.y),
      c.scale,
      stocked.has(c.id) ? 'S' : trashed.has(c.id) ? 'T' : 'P',
    ]);
  }
  return shape;
}
