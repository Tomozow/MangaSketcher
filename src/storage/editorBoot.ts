import { createEditorHistory } from './history';
import type { EditorDocument, EditorHistory } from './types';
import type { StorageDatabase } from './idb';
import { getDefaultStorageDatabase } from './idb';
import type { OpfsStorage } from './opfs';
import { getDefaultOpfsStorage } from './opfs';
import { loadProjectRasters } from './projectStore';

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
 * §7.9 editor boot restore:
 * - load document JSON
 * - load all raster PNGs into encodedPng
 * - OPFS pdf when opfsPath exists; missing OPFS keeps text JSON and empty picker state
 */
export async function loadEditorBoot(
  projectId: string,
  deps: EditorBootDeps = {},
): Promise<EditorBootResult | null> {
  const db = deps.db ?? getDefaultStorageDatabase();
  const opfs = deps.opfs ?? getDefaultOpfsStorage();
  const document = await db.getDocument(projectId);
  if (!document) {
    return null;
  }
  const encodedPng = await loadProjectRasters(document, { db });
  let pdfFile: File | null = null;
  let pdfMissing = false;
  if (document.pdf?.opfsPath) {
    pdfFile = await opfs.readPdf(projectId);
    if (!pdfFile) {
      pdfMissing = true;
    }
  }
  return {
    document,
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
