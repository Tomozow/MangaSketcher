import type { StorageDatabase } from './idb';
import { getDefaultStorageDatabase } from './idb';
import { pdfBlobRasterId, pdfOpfsPath } from './rasterIds';
import { OPFS_PDF_DIR } from './types';

export interface OpfsStorage {
  writePdf(projectId: string, data: ArrayBuffer): Promise<void>;
  readPdf(projectId: string): Promise<File | null>;
  deletePdf(projectId: string): Promise<void>;
  listPdfProjectIds(): Promise<string[]>;
}

export function isOpfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function getRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsAvailable()) {
    return null;
  }
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
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

/** True OPFS. Returns empty/no-op when the origin is not a secure context (iPad LAN HTTP). */
export class BrowserOpfsStorage implements OpfsStorage {
  async writePdf(projectId: string, data: ArrayBuffer): Promise<void> {
    const root = await getRoot();
    if (!root) {
      throw new Error('OPFS unavailable');
    }
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
      if (!root) {
        return null;
      }
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
      if (!root) {
        return;
      }
      const dir = await root.getDirectoryHandle(OPFS_PDF_DIR);
      await dir.removeEntry(`${projectId}.pdf`);
    } catch {
      // §7.5: missing OPFS file continues
    }
  }

  async listPdfProjectIds(): Promise<string[]> {
    try {
      const root = await getRoot();
      if (!root) {
        return [];
      }
      const dir = await root.getDirectoryHandle(OPFS_PDF_DIR);
      return listPdfNames(dir);
    } catch {
      return [];
    }
  }
}

/** IndexedDB fallback for PDF bytes when OPFS is missing (insecure HTTP). */
export class IdbPdfStorage implements OpfsStorage {
  constructor(private readonly getDb: () => StorageDatabase = getDefaultStorageDatabase) {}

  async writePdf(projectId: string, data: ArrayBuffer): Promise<void> {
    await this.getDb().putRaster(pdfBlobRasterId(projectId), data.slice(0));
  }

  async readPdf(projectId: string): Promise<File | null> {
    const bytes = await this.getDb().getRaster(pdfBlobRasterId(projectId));
    if (!bytes) {
      return null;
    }
    return new File([bytes], `${projectId}.pdf`, { type: 'application/pdf' });
  }

  async deletePdf(projectId: string): Promise<void> {
    await this.getDb().deleteRaster(pdfBlobRasterId(projectId));
  }

  async listPdfProjectIds(): Promise<string[]> {
    const ids = await this.getDb().listRasterIds();
    return ids.filter((id) => id.endsWith(':pdf')).map((id) => id.slice(0, -4));
  }
}

export class CompositePdfStorage implements OpfsStorage {
  constructor(
    private readonly opfs: OpfsStorage,
    private readonly idb: OpfsStorage,
  ) {}

  async writePdf(projectId: string, data: ArrayBuffer): Promise<void> {
    if (isOpfsAvailable()) {
      try {
        await this.opfs.writePdf(projectId, data);
        return;
      } catch {
        // private mode / permission — persist in IDB instead
      }
    }
    await this.idb.writePdf(projectId, data);
  }

  async readPdf(projectId: string): Promise<File | null> {
    const fromOpfs = await this.opfs.readPdf(projectId);
    if (fromOpfs) {
      return fromOpfs;
    }
    return this.idb.readPdf(projectId);
  }

  async deletePdf(projectId: string): Promise<void> {
    await this.opfs.deletePdf(projectId);
    await this.idb.deletePdf(projectId);
  }

  async listPdfProjectIds(): Promise<string[]> {
    const [a, b] = await Promise.all([this.opfs.listPdfProjectIds(), this.idb.listPdfProjectIds()]);
    return [...new Set([...a, ...b])];
  }
}

let defaultOpfs: OpfsStorage | null = null;

export function getDefaultOpfsStorage(): OpfsStorage {
  if (!defaultOpfs) {
    defaultOpfs = new CompositePdfStorage(new BrowserOpfsStorage(), new IdbPdfStorage());
  }
  return defaultOpfs;
}

export function setDefaultOpfsStorage(opfs: OpfsStorage | null): void {
  defaultOpfs = opfs;
}

export { pdfOpfsPath };
