import { cloneEditorDocument } from './editorDocument';
import { createEditorHistory } from './history';
import type { EditorDocument, EditorHistory } from './types';
import type { StorageDatabase } from './idb';
import { getDefaultStorageDatabase } from './idb';
import type { OpfsStorage } from './opfs';
import { getDefaultOpfsStorage } from './opfs';
import { loadProjectRasters } from './projectStore';
import { collectRasterIds } from './rasterIds';
import { documentRasterKey, documentRastersAreValid, metaFromDocument } from './generationSnapshot';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';
import { docShape, inkLog } from '@/src/web/ink/inkDebugLog';

export type EditorBootResult = {
  document: EditorDocument;
  encodedPng: Map<string, ArrayBuffer>;
  pdfFile: File | null;
  pdfMissing: boolean;
};

export type EditorBootDeps = {
  db?: StorageDatabase;
  opfs?: OpfsStorage;
};

/**
 * PNG of a fallback document. One written before revisions existed (no `generation`) kept its
 * PNGs in the snapshot store; later ones point at revisions in the live store.
 */
function snapshotRaster(db: StorageDatabase, snapshotDoc: EditorDocument, rasterId: string) {
  return snapshotDoc.generation === undefined
    ? db.getSnapshotRaster(rasterId)
    : db.getRaster(documentRasterKey(snapshotDoc, rasterId));
}

async function restoreLiveFromSnapshot(
  db: StorageDatabase,
  snapshotDoc: EditorDocument,
): Promise<EditorDocument> {
  const document = cloneEditorDocument(snapshotDoc);
  const rasters = new Map<string, ArrayBuffer>();
  for (const rasterId of collectRasterIds(document)) {
    const png = await snapshotRaster(db, snapshotDoc, rasterId);
    if (png) {
      rasters.set(rasterId, png);
    }
  }
  await db.commitDocumentGeneration({
    document,
    meta: metaFromDocument(document, new Date().toISOString()),
    rasters,
  });
  // Read back: the commit assigned the revisions the restored PNGs now live under.
  const restored = (await db.getDocument(document.projectId)) ?? document;
  ipadDebugLog({
    sessionId: 'gen-snap',
    hypothesisId: 'GS2',
    location: 'editorBoot.ts:restoreLiveFromSnapshot',
    message: 'restored live from generation snapshot',
    data: { projectId: document.projectId },
  });
  return restored;
}

/**
 * §7.9 editor boot restore:
 * - load document JSON
 * - load all raster PNGs into encodedPng
 * - OPFS pdf when opfsPath exists; missing OPFS keeps text JSON and empty picker state
 *
 * Generation snapshot: silent restore of live only when live is inconsistent
 * and the snapshot itself is valid. Consistent live wins even if snapshot is stale.
 * Missing PDF never triggers restore. `{projectId}:pdf` in rasters is ignored.
 */
export async function loadEditorBoot(
  projectId: string,
  deps: EditorBootDeps = {},
): Promise<EditorBootResult | null> {
  const db = deps.db ?? getDefaultStorageDatabase();
  const opfs = deps.opfs ?? getDefaultOpfsStorage();
  const meta = await db.getMeta(projectId);
  let loaded = await db.getDocument(projectId);
  const snapshotDoc = await db.getSnapshotDocument(projectId);
  const snapshotValid = snapshotDoc
    ? await documentRastersAreValid((id) => snapshotRaster(db, snapshotDoc, id), snapshotDoc)
    : false;

  if (!loaded) {
    if (meta && snapshotValid && snapshotDoc) {
      loaded = await restoreLiveFromSnapshot(db, snapshotDoc);
    } else {
      return null;
    }
  } else if (meta) {
    const live = loaded;
    const liveOk = await documentRastersAreValid((id) => db.getRaster(documentRasterKey(live, id)), live);
    if (!liveOk && snapshotValid && snapshotDoc) {
      loaded = await restoreLiveFromSnapshot(db, snapshotDoc);
    }
  }

  if (!loaded) {
    return null;
  }

  const document = cloneEditorDocument(loaded);
  const encodedPng = await loadProjectRasters(loaded, { db });
  inkLog('editorBoot.loadEditorBoot', 'boot rasters', {
    projectId,
    doc: docShape(document, true),
    rasters: collectRasterIds(document).map((id) => [id, encodedPng.get(id)?.byteLength ?? -1]),
  });
  let pdfFile: File | null = null;
  let pdfMissing = false;
  if (document.pdf?.opfsPath) {
    pdfFile = await opfs.readPdf(projectId);
    if (!pdfFile) {
      pdfMissing = true;
    }
  }
  return {
    document: cloneEditorDocument(document),
    encodedPng,
    pdfFile,
    pdfMissing,
  };
}

/**
 * §7.8 / §12 gate 13: session undo is not persisted. Reload always starts empty.
 */
export function editorHistoryFromBoot(boot: EditorBootResult): EditorHistory {
  return createEditorHistory(boot.document);
}

export async function readPdfArrayBuffer(
  projectId: string,
  deps: EditorBootDeps = {},
): Promise<ArrayBuffer | null> {
  const opfs = deps.opfs ?? getDefaultOpfsStorage();
  const file = await opfs.readPdf(projectId);
  if (!file) {
    return null;
  }
  return file.arrayBuffer();
}
