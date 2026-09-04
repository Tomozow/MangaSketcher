import { assertStorableDocument, cloneEditorDocument, createEditorDocument } from './editorDocument';
import type { StorageDatabase } from './idb';
import { getDefaultStorageDatabase } from './idb';
import type { OpfsStorage } from './opfs';
import { getDefaultOpfsStorage } from './opfs';
import {
  prepareImportedProjectFromZip,
  type PreparedImportedProject,
  type ProjectImportProgress,
} from './prepareImportedProject';
import {
  buildProjectPackFileName,
  buildProjectPackZip,
  ProjectPackError,
  rewriteImportedDocument,
} from './projectPack';
import {
  ProjectExportCheckpointError,
  requestProjectExportCheckpoint,
} from './projectExportCheckpoint';
import { randomId } from './randomId';
import { isStockPageItem } from '../domain/stockItems';
import { previewSpreadPageIds } from '../domain/layout';
import { clipRasterId, collectRasterIds, pageRasterId, pdfOpfsPath, rasterBelongsToProject } from './rasterIds';
import {
  copySharedTransparentPng,
  encodeTransparentPngBuffer,
  ensureSharedTransparentPng,
} from './transparentPng';
import type { EditorDocument, PageText, ProjectMeta } from './types';

export type { ProjectImportProgress } from './prepareImportedProject';

export type ProjectStoreDeps = {
  db?: StorageDatabase;
  opfs?: OpfsStorage;
  now?: () => string;
  requestExportCheckpoint?: (projectId: string) => Promise<void>;
  onImportProgress?: (progress: ProjectImportProgress) => void;
  prepareImported?: (
    zipBytes: Uint8Array,
    newProjectId: string,
    onProgress?: (progress: ProjectImportProgress) => void,
  ) => Promise<PreparedImportedProject>;
};

function resolveDeps(deps: ProjectStoreDeps = {}) {
  return {
    db: deps.db ?? getDefaultStorageDatabase(),
    opfs: deps.opfs ?? getDefaultOpfsStorage(),
    now: deps.now ?? (() => new Date().toISOString()),
    requestExportCheckpoint: deps.requestExportCheckpoint ?? requestProjectExportCheckpoint,
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

export async function duplicateProject(
  projectId: string,
  deps?: ProjectStoreDeps,
): Promise<ProjectMeta> {
  const { db, now, requestExportCheckpoint } = resolveDeps(deps);
  try {
    await requestExportCheckpoint(projectId);
  } catch (err) {
    if (err instanceof ProjectExportCheckpointError) {
      throw err;
    }
    throw new Error('複製の準備に失敗しました。');
  }

  const snapshot = await db.readProjectExportSnapshot(projectId);
  if (!snapshot) {
    throw new Error('プロジェクトが見つかりませんでした。');
  }

  const newProjectId = randomId();
  const document = rewriteImportedDocument(cloneEditorDocument(snapshot.document), newProjectId);
  document.name = `${snapshot.document.name} のコピー`;

  const fallback = encodeTransparentPngBuffer(document.rasterWidth, document.rasterHeight);
  const rasters = new Map<string, ArrayBuffer>();
  for (const page of Object.values(snapshot.document.pages)) {
    const destId = pageRasterId(newProjectId, page.id);
    const png = snapshot.rasters.get(page.rasterId) ?? fallback;
    rasters.set(destId, png.slice(0));
  }
  for (const clip of snapshot.document.pasteboardClips) {
    const destId = clipRasterId(newProjectId, clip.id);
    const png = snapshot.rasters.get(clip.rasterId) ?? fallback;
    rasters.set(destId, png.slice(0));
  }

  const meta = toMeta(document, now());
  await db.importProjectAtomic({ document, rasters, meta });
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

const LIST_THUMB_PAGE_LIMIT = 2;

function previewPageIds(doc: EditorDocument, maxPages: number): string[] {
  const fromWorkspace = previewSpreadPageIds(doc.workspaceOrder, doc.selectedPageId, maxPages).filter(
    (id) => doc.pages[id],
  );
  if (fromWorkspace.length > 0) {
    return fromWorkspace;
  }
  const seen = new Set<string>();
  const fromStock: string[] = [];
  for (const item of doc.stock) {
    if (!isStockPageItem(item) || seen.has(item.pageId) || !doc.pages[item.pageId]) {
      continue;
    }
    seen.add(item.pageId);
    fromStock.push(item.pageId);
    if (fromStock.length >= maxPages) {
      break;
    }
  }
  return fromStock;
}

export type ProjectPreviewPage = {
  pageId: string;
  png: ArrayBuffer | null;
  texts: PageText[];
  rasterWidth: number;
  rasterHeight: number;
};

export async function loadProjectPreviewPages(
  projectId: string,
  maxPages = LIST_THUMB_PAGE_LIMIT,
  deps?: ProjectStoreDeps,
): Promise<ProjectPreviewPage[]> {
  const { db } = resolveDeps(deps);
  const loaded = await db.getDocument(projectId);
  if (!loaded) {
    return [];
  }
  const doc = cloneEditorDocument(loaded);
  const pages: ProjectPreviewPage[] = [];
  for (const pageId of previewPageIds(doc, maxPages)) {
    const page = doc.pages[pageId];
    if (!page) {
      continue;
    }
    const png = await db.getRaster(page.rasterId);
    pages.push({
      pageId,
      png: png ? png.slice(0) : null,
      texts: page.texts,
      rasterWidth: doc.rasterWidth,
      rasterHeight: doc.rasterHeight,
    });
  }
  return pages;
}

export function projectHasPdf(document: EditorDocument): boolean {
  return document.pdf?.opfsPath != null;
}

export async function exportProjectPack(
  projectId: string,
  deps?: ProjectStoreDeps,
): Promise<File> {
  const { db, now, requestExportCheckpoint } = resolveDeps(deps);
  try {
    await requestExportCheckpoint(projectId);
  } catch (err) {
    if (err instanceof ProjectExportCheckpointError) {
      throw err;
    }
    throw new Error('エクスポートの準備に失敗しました。');
  }

  const snapshot = await db.readProjectExportSnapshot(projectId);
  if (!snapshot) {
    throw new Error('プロジェクトが見つかりませんでした。');
  }

  const needed = collectRasterIds(snapshot.document);
  for (const rasterId of needed) {
    if (snapshot.rasters.has(rasterId)) {
      continue;
    }
    snapshot.rasters.set(
      rasterId,
      encodeTransparentPngBuffer(snapshot.document.rasterWidth, snapshot.document.rasterHeight),
    );
  }

  const exportedAt = new Date(now());
  const bytes = buildProjectPackZip({
    document: snapshot.document,
    rasters: snapshot.rasters,
  });
  const fileName = buildProjectPackFileName(snapshot.document.name, exportedAt);
  const copy = bytes.slice();
  return new File([copy.buffer], fileName, {
    type: 'application/zip',
    lastModified: exportedAt.getTime(),
  });
}

export async function importProjectPack(
  file: Blob,
  deps?: ProjectStoreDeps,
): Promise<ProjectMeta> {
  const { db, now } = resolveDeps(deps);
  const onProgress = deps?.onImportProgress;
  const prepareImported =
    deps?.prepareImported ??
    ((zipBytes, newProjectId, progress) =>
      prepareImportedProjectFromZip(zipBytes, newProjectId, { onProgress: progress }));
  onProgress?.({ phase: 'reading' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const newProjectId = randomId();
  let prepared: PreparedImportedProject;
  try {
    prepared = await prepareImported(bytes, newProjectId, onProgress);
  } catch (err) {
    if (err instanceof ProjectPackError) {
      throw err;
    }
    throw new ProjectPackError('インポートに失敗しました。');
  }

  const meta = toMeta(prepared.document, now());
  onProgress?.({ phase: 'saving' });
  try {
    await db.importProjectAtomic({
      document: prepared.document,
      rasters: prepared.rasters,
      meta,
    });
  } catch (err) {
    if (err instanceof ProjectPackError) {
      throw err;
    }
    throw new ProjectPackError('インポートに失敗しました。');
  }
  return meta;
}
