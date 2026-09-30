import { collectRasterIds } from './rasterIds';
import { storedPngIsValid } from './generationSnapshot';
import type { StorageDatabase } from './idb';
import { encodedRasterDimensions } from '@/src/web/ink/fakeCanvas';

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
  const wanted = only ? new Set(only) : null;
  const recovered: Array<{ clipId: string; rasterId: string }> = [];
  for (const rasterId of await db.listRasterIds()) {
    if (!rasterId.startsWith(prefix) || referenced.has(rasterId)) {
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
    doc.pasteboardClips.push({
      id: clipId,
      rasterId,
      x: 80 + (index % GRID_COLUMNS) * GRID_STEP_X,
      y: baseY + Math.floor(index / GRID_COLUMNS) * GRID_STEP_Y,
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
    snapshot: 'guarded',
  });
  return recovered.map((item) => item.clipId);
}
