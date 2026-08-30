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
  await opfs.deletePdf(projectId);
  await db.deleteProjectRecords(projectId);
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
  for (const rasterId of rasterIds) {
    if (referenced.has(rasterId)) {
      continue;
    }
    const owner = rasterId.split(':')[0];
    if (!owner || !liveIds.has(owner)) {
      await db.deleteRaster(rasterId);
      continue;
    }
    if (!rasterBelongsToProject(rasterId, owner)) {
      await db.deleteRaster(rasterId);
    }
  }
}

export function projectHasPdf(document: EditorDocument): boolean {
  return document.pdf?.opfsPath != null;
}
