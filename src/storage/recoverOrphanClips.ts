import { collectRasterIds } from './rasterIds';
import { storedPngIsValid } from './generationSnapshot';
import type { StorageDatabase } from './idb';
import { encodedRasterDimensions } from '@/src/web/ink/fakeCanvas';
import { buildStripFrames, stripLayoutFromDoc } from '@/src/domain/stripGeometry';

const GRID_COLUMNS = 6;
const GRID_STEP_X = 240;
const GRID_STEP_Y = 340;
/** Transparent / near-empty clip PNGs are below this; not worth putting back. */
const MIN_RECOVER_BYTES = 3000;

/**
 * Deleting clips (trash → empty) only drops them from the document; their PNGs stay in `rasters`.
 * Put stored-but-unreferenced clip rasters back on the pasteboard, in a grid below existing clips.
 *
 * `only`: clip ids (the part after `:clip:`) to restore; omit to restore every orphan with real ink.
 * An entry may be `clipId@pageId@x@y` to put the clip back where it was cut from: x / y are raster
 * pixels on that page (the cut's trim origin).
 */
export async function recoverOrphanClips(
  projectId: string,
  db: StorageDatabase,
  only?: readonly string[],
): Promise<string[]> {
  const doc = await db.getDocument(projectId);
  if (!doc) {
    return [];
  }
  const referenced = new Set(collectRasterIds(doc));
  const prefix = `${projectId}:clip:`;
  const placement = new Map<string, { pageId: string; x: number; y: number }>();
  for (const entry of only ?? []) {
    const [clipId, pageId, x, y] = entry.split('@');
    if (clipId && pageId && Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      placement.set(clipId, { pageId, x: Number(x), y: Number(y) });
    }
  }
  const wanted = only ? new Set(only.map((entry) => entry.split('@')[0]!)) : null;
  const frames = buildStripFrames(doc.workspaceOrder, stripLayoutFromDoc(doc)).frames;
  const recovered: Array<{ clipId: string; rasterId: string }> = [];
  for (const rasterId of await db.listRasterIds()) {
    // Revisions are managed by the generation GC; only un-revisioned keys can be orphans to restore.
    if (!rasterId.startsWith(prefix) || rasterId.includes('@') || referenced.has(rasterId)) {
      continue;
    }
    const clipId = rasterId.slice(prefix.length);
    if (wanted && !wanted.has(clipId)) {
      continue;
    }
    const png = await db.getRaster(rasterId);
    if (!png || !storedPngIsValid(png) || !encodedRasterDimensions(png)) {
      continue;
    }
    if (!wanted && png.byteLength < MIN_RECOVER_BYTES) {
      continue;
    }
    recovered.push({ clipId, rasterId });
  }
  if (recovered.length === 0) {
    return [];
  }
  const baseY = doc.pasteboardClips.reduce((max, clip) => Math.max(max, clip.y), 0) + GRID_STEP_Y * 1.5;
  recovered.forEach(({ clipId, rasterId }, index) => {
    const at = placement.get(clipId);
    const frame = at ? frames.find((f) => f.slot.kind === 'page' && f.slot.pageId === at.pageId) : undefined;
    doc.pasteboardClips.push({
      id: clipId,
      rasterId,
      x: at && frame ? frame.x + (at.x / doc.rasterWidth) * frame.width : 80 + (index % GRID_COLUMNS) * GRID_STEP_X,
      y:
        at && frame
          ? frame.y + (at.y / doc.rasterHeight) * frame.height
          : baseY + Math.floor(index / GRID_COLUMNS) * GRID_STEP_Y,
      scale: 1,
      rotation: 0,
    });
  });
  await db.commitDocumentGeneration({
    document: doc,
    meta: {
      id: doc.projectId,
      name: doc.name,
      updatedAt: new Date().toISOString(),
      pageCount: Object.keys(doc.pages).length,
    },
  });
  return recovered.map((item) => item.clipId);
}
