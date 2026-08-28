import { OPFS_PDF_DIR } from './types';
import { pdfOpfsPath } from './rasterIds';

export interface OpfsStorage {
  writePdf(projectId: string, data: ArrayBuffer): Promise<void>;
  readPdf(projectId: string): Promise<File | null>;
  deletePdf(projectId: string): Promise<void>;
  listPdfProjectIds(): Promise<string[]>;
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('OPFS unavailable');
  }
  return navigator.storage.getDirectory();
}

async function ensurePdfDir(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  return root.getDirectoryHandle(OPFS_PDF_DIR, { create: true });
}

async function listPdfNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const ids: string[] = [];
  const listing = dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
  for await (const [name] of listing) {
    if (name.endsWith('.pdf')) {
      ids.push(name.slice(0, -4));
    }
  }
  return ids;
}

export class BrowserOpfsStorage implements OpfsStorage {
  async writePdf(projectId: string, data: ArrayBuffer): Promise<void> {
    const root = await getRoot();
    const dir = await ensurePdfDir(root);
    const fileName = `${projectId}.pdf`;
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  async readPdf(projectId: string): Promise<File | null> {
    try {
      const root = await getRoot();
      const dir = await root.getDirectoryHandle(OPFS_PDF_DIR);
      const handle = await dir.getFileHandle(`${projectId}.pdf`);
      return handle.getFile();
    } catch {
      return null;
    }
  }

  async deletePdf(projectId: string): Promise<void> {
    try {
      const root = await getRoot();
      const dir = await root.getDirectoryHandle(OPFS_PDF_DIR);
      await dir.removeEntry(`${projectId}.pdf`);
    } catch {
      // §7.5: missing OPFS file continues
    }
  }

  async listPdfProjectIds(): Promise<string[]> {
    try {
      const root = await getRoot();
      const dir = await root.getDirectoryHandle(OPFS_PDF_DIR);
      return listPdfNames(dir);
    } catch {
      return [];
    }
  }
}

let defaultOpfs: OpfsStorage | null = null;

export function getDefaultOpfsStorage(): OpfsStorage {
  if (!defaultOpfs) {
    defaultOpfs = new BrowserOpfsStorage();
  }
  return defaultOpfs;
}

export function setDefaultOpfsStorage(opfs: OpfsStorage | null): void {
  defaultOpfs = opfs;
}

export { pdfOpfsPath };
