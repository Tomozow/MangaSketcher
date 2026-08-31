import { strFromU8, strToU8, unzipSync, zipSync, type UnzipFile, type Zippable } from 'fflate/browser';
import { formatExportTimestamp, sanitizeExportStem } from '../web/export/sanitizeExportName';
import { compactPackRasterPng } from './compactInkPng';
import { assertStorableDocument, cloneEditorDocument } from './editorDocument';
import { clipRasterId, collectRasterIds, pageRasterId } from './rasterIds';
import type { EditorDocument, ProjectId } from './types';

export const PROJECT_PACK_MAGIC = 'mangasketcher-project-pack';
export const PROJECT_PACK_FORMAT_VERSION = 1;

export const MANIFEST_JSON = 'manifest.json';
export const DOCUMENT_JSON = 'document.json';

export const MAX_PACK_ZIP_BYTES = 200 * 1024 * 1024;
export const MAX_PACK_ENTRIES = 4096;
export const MAX_PACK_RASTER_BYTES = 32 * 1024 * 1024;

export class ProjectPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectPackError';
  }
}

export type ProjectPackManifest = {
  magic: typeof PROJECT_PACK_MAGIC;
  formatVersion: typeof PROJECT_PACK_FORMAT_VERSION;
  exportedProjectId: ProjectId;
  rasterMembers: string[];
};

export type ParsedProjectPack = {
  manifest: ProjectPackManifest;
  document: EditorDocument;
  /** Zip entry path → PNG bytes */
  rasters: Map<string, ArrayBuffer>;
};

const RASTER_ZIP_PATH_RE = /^rasters\/(page|clip)__[^/\\]+\.png$/;

export function buildProjectPackFileName(name: string, date: Date): string {
  const stem = sanitizeExportStem(name);
  const timestamp = formatExportTimestamp(date);
  return `${stem}_mangasketcher_${timestamp}.zip`;
}

export function rasterZipPathFromPageId(pageId: string): string {
  return `rasters/page__${pageId}.png`;
}

export function rasterZipPathFromClipId(clipId: string): string {
  return `rasters/clip__${clipId}.png`;
}

export function rasterZipPathForDocumentMember(doc: EditorDocument, rasterId: string): string {
  for (const page of Object.values(doc.pages)) {
    if (page.rasterId === rasterId) {
      return rasterZipPathFromPageId(page.id);
    }
  }
  for (const clip of doc.pasteboardClips) {
    if (clip.rasterId === rasterId) {
      return rasterZipPathFromClipId(clip.id);
    }
  }
  throw new ProjectPackError('ラスター参照が不正です。');
}

function isSafeZipMemberPath(path: string): boolean {
  if (!path || path.includes('\\') || path.includes('..') || path.startsWith('/')) {
    return false;
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    return false;
  }
  return true;
}

function isAllowedPackPath(path: string): boolean {
  if (!isSafeZipMemberPath(path)) {
    return false;
  }
  if (path === MANIFEST_JSON || path === DOCUMENT_JSON) {
    return true;
  }
  return RASTER_ZIP_PATH_RE.test(path);
}

function isPng(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes);
  return (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = bytes.slice();
  return copy.buffer;
}

function stripPdfForPack(doc: EditorDocument): EditorDocument {
  return cloneEditorDocument({ ...doc, pdf: null });
}

export function validateImportedDocument(raw: unknown): EditorDocument {
  if (!raw || typeof raw !== 'object') {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  const doc = raw as EditorDocument;
  if (typeof doc.projectId !== 'string' || doc.projectId.length === 0) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  if (typeof doc.name !== 'string') {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  if (
    !Number.isFinite(doc.rasterWidth) ||
    !Number.isFinite(doc.rasterHeight) ||
    doc.rasterWidth < 1 ||
    doc.rasterHeight < 1
  ) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  if (!doc.pages || typeof doc.pages !== 'object') {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  const pageIds = Object.keys(doc.pages);
  if (pageIds.length === 0) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  for (const pageId of pageIds) {
    const page = doc.pages[pageId];
    if (!page || page.id !== pageId || typeof page.rasterId !== 'string') {
      throw new ProjectPackError('プロジェクトデータが不正です。');
    }
    if (!Array.isArray(page.texts)) {
      throw new ProjectPackError('プロジェクトデータが不正です。');
    }
  }
  if (!Array.isArray(doc.workspaceOrder)) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  for (const pageId of doc.workspaceOrder) {
    if (!doc.pages[pageId]) {
      throw new ProjectPackError('プロジェクトデータが不正です。');
    }
  }
  if (!Array.isArray(doc.trash)) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  for (const pageId of doc.trash) {
    if (!doc.pages[pageId]) {
      throw new ProjectPackError('プロジェクトデータが不正です。');
    }
  }
  if (!Array.isArray(doc.stock)) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  if (!Array.isArray(doc.pasteboardClips)) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  for (const clip of doc.pasteboardClips) {
    if (!clip || typeof clip.id !== 'string' || typeof clip.rasterId !== 'string') {
      throw new ProjectPackError('プロジェクトデータが不正です。');
    }
  }
  if (!Array.isArray(doc.pasteboardTexts)) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }
  return stripPdfForPack(doc);
}

function safeUnzipPack(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_PACK_ZIP_BYTES) {
    throw new ProjectPackError('ZIPファイルが大きすぎます。');
  }
  let entryCount = 0;
  try {
    return unzipSync(bytes, {
      filter(file: UnzipFile) {
        const path = file.name;
        if (path.endsWith('/')) {
          return false;
        }
        if (!isAllowedPackPath(path)) {
          throw new ProjectPackError('プロジェクトパックではありません。');
        }
        entryCount += 1;
        if (entryCount > MAX_PACK_ENTRIES) {
          throw new ProjectPackError('ZIPのエントリ数が多すぎます。');
        }
        const size = file.originalSize ?? file.size;
        if (size > MAX_PACK_RASTER_BYTES) {
          throw new ProjectPackError('ZIPのエントリが大きすぎます。');
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ProjectPackError) {
      throw err;
    }
    throw new ProjectPackError('ZIPファイルを読み込めませんでした。');
  }
}

export function buildProjectPackZip(input: {
  document: EditorDocument;
  rasters: ReadonlyMap<string, ArrayBuffer>;
}): Uint8Array {
  const document = stripPdfForPack(input.document);
  assertStorableDocument(document);

  const rasterIds = collectRasterIds(document);
  const rasterMembers: string[] = [];
  const files: Zippable = {};

  for (const rasterId of rasterIds) {
    const png = input.rasters.get(rasterId);
    if (!png) {
      throw new ProjectPackError('ラスターデータが不足しています。');
    }
    if (!isPng(png)) {
      throw new ProjectPackError('ラスターデータが不正です。');
    }
    const zipPath = rasterZipPathForDocumentMember(document, rasterId);
    rasterMembers.push(zipPath);
    files[zipPath] = [new Uint8Array(compactPackRasterPng(png)), { level: 0 }];
  }

  const manifest: ProjectPackManifest = {
    magic: PROJECT_PACK_MAGIC,
    formatVersion: PROJECT_PACK_FORMAT_VERSION,
    exportedProjectId: document.projectId,
    rasterMembers: [...rasterMembers].sort(),
  };

  files[MANIFEST_JSON] = strToU8(JSON.stringify(manifest), false);
  files[DOCUMENT_JSON] = strToU8(JSON.stringify(document), false);

  return zipSync(files);
}

export function parseProjectPackZip(bytes: Uint8Array): ParsedProjectPack {
  const entries = safeUnzipPack(bytes);
  const paths = Object.keys(entries);
  if (paths.length === 0) {
    throw new ProjectPackError('プロジェクトパックではありません。');
  }

  const manifestBytes = entries[MANIFEST_JSON];
  const documentBytes = entries[DOCUMENT_JSON];
  if (!manifestBytes || !documentBytes) {
    throw new ProjectPackError('プロジェクトパックではありません。');
  }

  let manifest: ProjectPackManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as ProjectPackManifest;
  } catch {
    throw new ProjectPackError('プロジェクトパックの形式が不正です。');
  }

  if (manifest.magic !== PROJECT_PACK_MAGIC) {
    throw new ProjectPackError('プロジェクトパックではありません。');
  }
  if (manifest.formatVersion !== PROJECT_PACK_FORMAT_VERSION) {
    throw new ProjectPackError('このバージョンのパックには対応していません。');
  }
  if (!manifest.exportedProjectId || typeof manifest.exportedProjectId !== 'string') {
    throw new ProjectPackError('プロジェクトパックの形式が不正です。');
  }
  if (!Array.isArray(manifest.rasterMembers)) {
    throw new ProjectPackError('プロジェクトパックの形式が不正です。');
  }

  const memberSet = new Set<string>();
  for (const member of manifest.rasterMembers) {
    if (typeof member !== 'string' || !RASTER_ZIP_PATH_RE.test(member)) {
      throw new ProjectPackError('プロジェクトパックの形式が不正です。');
    }
    if (memberSet.has(member)) {
      throw new ProjectPackError('プロジェクトパックの内容が不正です。');
    }
    memberSet.add(member);
  }

  let document: EditorDocument;
  try {
    document = validateImportedDocument(JSON.parse(strFromU8(documentBytes)));
  } catch (err) {
    if (err instanceof ProjectPackError) {
      throw err;
    }
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }

  if (document.projectId !== manifest.exportedProjectId) {
    throw new ProjectPackError('プロジェクトデータが不正です。');
  }

  const expectedMembers = new Set<string>();
  for (const rasterId of collectRasterIds(document)) {
    expectedMembers.add(rasterZipPathForDocumentMember(document, rasterId));
  }

  if (memberSet.size !== expectedMembers.size) {
    throw new ProjectPackError('プロジェクトパックの内容が不正です。');
  }
  for (const member of memberSet) {
    if (!expectedMembers.has(member)) {
      throw new ProjectPackError('プロジェクトパックの内容が不正です。');
    }
  }

  const allowedPaths = new Set<string>([MANIFEST_JSON, DOCUMENT_JSON, ...memberSet]);
  for (const path of paths) {
    if (!allowedPaths.has(path)) {
      throw new ProjectPackError('プロジェクトパックの内容が不正です。');
    }
  }

  const rasters = new Map<string, ArrayBuffer>();
  for (const member of memberSet) {
    const pngBytes = entries[member];
    if (!pngBytes) {
      throw new ProjectPackError('ラスターデータが不足しています。');
    }
    const png = toArrayBuffer(pngBytes);
    if (!isPng(png)) {
      throw new ProjectPackError('ラスターデータが不正です。');
    }
    rasters.set(member, png);
  }

  return { manifest, document, rasters };
}

export function rewriteImportedDocument(document: EditorDocument, newProjectId: ProjectId): EditorDocument {
  const doc = validateImportedDocument(document);
  doc.projectId = newProjectId;
  doc.pdf = null;

  for (const page of Object.values(doc.pages)) {
    page.rasterId = pageRasterId(newProjectId, page.id);
  }
  for (const clip of doc.pasteboardClips) {
    clip.rasterId = clipRasterId(newProjectId, clip.id);
  }

  assertStorableDocument(doc);
  return doc;
}
