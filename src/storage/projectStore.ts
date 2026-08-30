import { ipadDebugLog } from '../web/ipadDebugLog';
import { assertStorableDocument, cloneEditorDocument, createEditorDocument } from './editorDocument';
import type { StorageDatabase } from './idb';
import { getDefaultStorageDatabase } from './idb';
import type { OpfsStorage } from './opfs';
import { getDefaultOpfsStorage } from './opfs';
import { collectRasterIds, pdfOpfsPath, rasterBelongsToProject } from './rasterIds';
import { copySharedTransparentPng, ensureSharedTransparentPng } from './transparentPng';
import type { EditorDocument, ProjectMeta } from './types';

export type ProjectStoreDeps = {
  db?: StorageDatabase;
  opfs?: OpfsStorage;
  now?: () => string;
};

function resolveDeps(deps: ProjectStoreDeps = {}) {
  return {
    db: deps.db ?? getDefaultStorageDatabase(),
    opfs: deps.opfs ?? getDefaultOpfsStorage(),
    now: deps.now ?? (() => new Date().toISOString()),
  };
}

function toMeta(doc: EditorDocument, updatedAt: string): ProjectMeta {
  return {
    id: doc.projectId,
    name: doc.name,
    updatedAt,
    pageCount: Object.keys(doc.pages).length,
  };
}

export async function listProjects(deps?: ProjectStoreDeps): Promise<ProjectMeta[]> {
  const { db } = resolveDeps(deps);
  const items = await db.listMeta();
  return [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function createProject(
  name: string,
  pageCount: number,
  deps?: ProjectStoreDeps,
): Promise<{ meta: ProjectMeta; document: EditorDocument }> {
  const { db, now } = resolveDeps(deps);
  // #region agent log
  ipadDebugLog({
    sessionId: '092972',
    ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
    hypothesisId: 'H',
    location: 'projectStore.ts:createProject:start',
    message: 'createProject start',
    data: { pageCount },
    timestamp: Date.now(),
  });
  // #endregion
  try {
    await ensureSharedTransparentPng();
    const document = createEditorDocument({ name, pageCount });
    assertStorableDocument(document);
    const transparent = copySharedTransparentPng();
    for (const rasterId of collectRasterIds(document)) {
      await db.putRaster(rasterId, transparent.slice(0));
    }
    const updatedAt = now();
    const meta = toMeta(document, updatedAt);
    await db.putDocument(document);
    await db.putMeta(meta);
    return { meta, document };
  } catch (err) {
    // #region agent log
    ipadDebugLog({
      sessionId: '092972',
      ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
      hypothesisId: 'H',
      location: 'projectStore.ts:createProject:catch',
      message: 'createProject failed',
      data: {
        pageCount,
        name: err instanceof Error ? err.name : '',
        message: err instanceof Error ? err.message : String(err),
      },
      timestamp: Date.now(),
    });
    // #endregion
    throw err;
  }
}

export async function loadDocument(
  projectId: string,
  deps?: ProjectStoreDeps,
): Promise<EditorDocument | null> {
  const { db } = resolveDeps(deps);
  const loaded = await db.getDocument(projectId);
  return loaded ? cloneEditorDocument(loaded) : null;
}

export async function loadProjectRasters(
  document: EditorDocument,
  deps?: ProjectStoreDeps,
): Promise<Map<string, ArrayBuffer>> {
  const { db } = resolveDeps(deps);
  const encoded = new Map<string, ArrayBuffer>();
  for (const rasterId of collectRasterIds(document)) {
    const png = await db.getRaster(rasterId);
    if (png) {
      encoded.set(rasterId, png.slice(0));
    }
  }
  return encoded;
}

export async function saveProjectDocument(
  document: EditorDocument,
  encodedPng: ReadonlyMap<string, ArrayBuffer>,
  deps?: ProjectStoreDeps,
): Promise<ProjectMeta> {
  const { db, now } = resolveDeps(deps);
  const doc = cloneEditorDocument(document);
  assertStorableDocument(doc);
  for (const rasterId of collectRasterIds(doc)) {
    const png = encodedPng.get(rasterId);
    if (png) {
      await db.putRaster(rasterId, png.slice(0));
    }
  }
  const meta = toMeta(doc, now());
  await db.putDocument(doc);
  await db.putMeta(meta);
  return meta;
}

export async function renameProject(
  projectId: string,
  name: string,
  deps?: ProjectStoreDeps,
): Promise<ProjectMeta | null> {
  const { db, now } = resolveDeps(deps);
  const doc = await db.getDocument(projectId);
  if (!doc) {
    return null;
  }
  doc.name = name;
  const meta = toMeta(doc, now());
  await db.putDocument(doc);
  await db.putMeta(meta);
  return meta;
}

/**
 * §7.5 fixed delete order:
 * 1. OPFS pdf delete (missing file is ok)
 * 2. One IDB transaction: rasters prefix → documents → meta
 */
export async function deleteProject(projectId: string, deps?: ProjectStoreDeps): Promise<void> {
  const { db, opfs } = resolveDeps(deps);
  // #region agent log
  ipadDebugLog({
    sessionId: '092972',
    ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
    hypothesisId: 'A',
    location: 'projectStore.ts:deleteProject',
    message: 'deleteProject start',
    data: { projectId },
    timestamp: Date.now(),
  });
  // #endregion
  try {
    await opfs.deletePdf(projectId);
    await db.deleteProjectRecords(projectId);
  } catch (err) {
    // #region agent log
    ipadDebugLog({
      sessionId: '092972',
      ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
      hypothesisId: 'A',
      location: 'projectStore.ts:deleteProject:catch',
      message: 'deleteProject failed',
      data: {
        projectId,
        name: err instanceof Error ? err.name : '',
        message: err instanceof Error ? err.message : String(err),
      },
      timestamp: Date.now(),
    });
    // #endregion
    throw err;
  }
}

export async function writeProjectPdf(
  projectId: string,
  data: ArrayBuffer,
  deps?: ProjectStoreDeps,
): Promise<string> {
  const { opfs } = resolveDeps(deps);
  await opfs.writePdf(projectId, data);
  return pdfOpfsPath(projectId);
}

export async function runStartupGc(deps?: ProjectStoreDeps): Promise<void> {
  const { db, opfs } = resolveDeps(deps);
  const meta = await db.listMeta();
  const liveIds = new Set(meta.map((item) => item.id));
  // #region agent log
  ipadDebugLog({
    sessionId: '092972',
    ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
    hypothesisId: 'C',
    location: 'projectStore.ts:runStartupGc:start',
    message: 'startup GC start',
    data: { metaCount: meta.length },
    timestamp: Date.now(),
  });
  // #endregion

  const pdfIds = await opfs.listPdfProjectIds();
  for (const projectId of pdfIds) {
    if (!liveIds.has(projectId)) {
      await opfs.deletePdf(projectId);
    }
  }

  const referenced = new Set<string>();
  for (const item of meta) {
    const doc = await db.getDocument(item.id);
    if (!doc) {
      continue;
    }
    for (const rasterId of collectRasterIds(doc)) {
      referenced.add(rasterId);
    }
  }

  const rasterIds = await db.listRasterIds();
  let deleted = 0;
  try {
    for (const rasterId of rasterIds) {
      if (referenced.has(rasterId)) {
        continue;
      }
      const owner = rasterId.split(':')[0];
      if (!owner || !liveIds.has(owner)) {
        await db.deleteRaster(rasterId);
        deleted += 1;
        continue;
      }
      if (!rasterBelongsToProject(rasterId, owner)) {
        await db.deleteRaster(rasterId);
        deleted += 1;
      }
    }
  } catch (err) {
    // #region agent log
    ipadDebugLog({
      sessionId: '092972',
      ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
      hypothesisId: 'C',
      location: 'projectStore.ts:runStartupGc:catch',
      message: 'startup GC delete failed',
      data: {
        rasterCount: rasterIds.length,
        referenced: referenced.size,
        deleted,
        name: err instanceof Error ? err.name : '',
        message: err instanceof Error ? err.message : String(err),
      },
      timestamp: Date.now(),
    });
    // #endregion
    throw err;
  }
  // #region agent log
  ipadDebugLog({
    sessionId: '092972',
    ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
    hypothesisId: 'C',
    location: 'projectStore.ts:runStartupGc:done',
    message: 'startup GC done',
    data: { rasterCount: rasterIds.length, referenced: referenced.size, deleted },
    timestamp: Date.now(),
  });
  // #endregion
}

export function projectHasPdf(document: EditorDocument): boolean {
  return document.pdf?.opfsPath != null;
}
