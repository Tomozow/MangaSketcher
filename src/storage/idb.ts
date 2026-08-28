import { DB_NAME, DB_VERSION, type EditorDocument, type ProjectMeta } from './types';

export type MetaStore = 'meta';
export type DocumentsStore = 'documents';
export type RastersStore = 'rasters';

export type StoreName = MetaStore | DocumentsStore | RastersStore;

export interface StorageDatabase {
  listMeta(): Promise<ProjectMeta[]>;
  getMeta(id: string): Promise<ProjectMeta | undefined>;
  putMeta(meta: ProjectMeta): Promise<void>;
  deleteMeta(id: string): Promise<void>;

  getDocument(id: string): Promise<EditorDocument | undefined>;
  putDocument(doc: EditorDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;

  getRaster(rasterId: string): Promise<ArrayBuffer | undefined>;
  putRaster(rasterId: string, png: ArrayBuffer): Promise<void>;
  deleteRaster(rasterId: string): Promise<void>;
  listRasterIds(): Promise<string[]>;

  deleteProjectRecords(projectId: string): Promise<void>;
}

export type DeleteProjectRecordsOptions = {
  projectId: string;
};

const META = 'meta';
const DOCUMENTS = 'documents';
const RASTERS = 'rasters';

function openBrowserDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        db.createObjectStore(DOCUMENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(RASTERS)) {
        db.createObjectStore(RASTERS, { keyPath: 'rasterId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function tx<T>(
  db: IDBDatabase,
  storeNames: StoreName[],
  mode: IDBTransactionMode,
  run: (stores: Record<StoreName, IDBObjectStore>) => Promise<T> | T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    const stores = {
      meta: transaction.objectStore(META),
      documents: transaction.objectStore(DOCUMENTS),
      rasters: transaction.objectStore(RASTERS),
    };
    Promise.resolve(run(stores))
      .then(resolve)
      .catch(reject);
    transaction.onerror = () => reject(transaction.error ?? new Error('idb transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('idb transaction aborted'));
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('idb request failed'));
  });
}

export class BrowserStorageDatabase implements StorageDatabase {
  private dbPromise: Promise<IDBDatabase>;

  constructor(dbPromise?: Promise<IDBDatabase>) {
    this.dbPromise = dbPromise ?? openBrowserDatabase();
  }

  private async db(): Promise<IDBDatabase> {
    return this.dbPromise;
  }

  async listMeta(): Promise<ProjectMeta[]> {
    const db = await this.db();
    return tx(db, [META], 'readonly', async ({ meta }) => {
      const all = await req(meta.getAll());
      return all as ProjectMeta[];
    });
  }

  async getMeta(id: string): Promise<ProjectMeta | undefined> {
    const db = await this.db();
    return tx(db, [META], 'readonly', async ({ meta }) => {
      const value = await req(meta.get(id));
      return value as ProjectMeta | undefined;
    });
  }

  async putMeta(meta: ProjectMeta): Promise<void> {
    const db = await this.db();
    await tx(db, [META], 'readwrite', async ({ meta: store }) => {
      await req(store.put(meta));
    });
  }

  async deleteMeta(id: string): Promise<void> {
    const db = await this.db();
    await tx(db, [META], 'readwrite', async ({ meta: store }) => {
      await req(store.delete(id));
    });
  }

  async getDocument(id: string): Promise<EditorDocument | undefined> {
    const db = await this.db();
    return tx(db, [DOCUMENTS], 'readonly', async ({ documents }) => {
      const stored = await req(documents.get(id));
      if (!stored) {
        return undefined;
      }
      const { id: _key, ...doc } = stored as EditorDocument & { id: string };
      return { ...doc, projectId: stored.id ?? doc.projectId } as EditorDocument;
    });
  }

  async putDocument(doc: EditorDocument): Promise<void> {
    const db = await this.db();
    await tx(db, [DOCUMENTS], 'readwrite', async ({ documents }) => {
      await req(documents.put({ ...doc, id: doc.projectId }));
    });
  }

  async deleteDocument(id: string): Promise<void> {
    const db = await this.db();
    await tx(db, [DOCUMENTS], 'readwrite', async ({ documents }) => {
      await req(documents.delete(id));
    });
  }

  async getRaster(rasterId: string): Promise<ArrayBuffer | undefined> {
    const db = await this.db();
    return tx(db, [RASTERS], 'readonly', async ({ rasters }) => {
      const stored = await req(rasters.get(rasterId));
      if (!stored) {
        return undefined;
      }
      if (stored instanceof ArrayBuffer) {
        return stored;
      }
      return (stored as { png: ArrayBuffer }).png;
    });
  }

  async putRaster(rasterId: string, png: ArrayBuffer): Promise<void> {
    const db = await this.db();
    await tx(db, [RASTERS], 'readwrite', async ({ rasters }) => {
      await req(rasters.put({ rasterId, png }));
    });
  }

  async deleteRaster(rasterId: string): Promise<void> {
    const db = await this.db();
    await tx(db, [RASTERS], 'readwrite', async ({ rasters }) => {
      await req(rasters.delete(rasterId));
    });
  }

  async listRasterIds(): Promise<string[]> {
    const db = await this.db();
    return tx(db, [RASTERS], 'readonly', async ({ rasters }) => {
      const keys = await req(rasters.getAllKeys());
      return keys as string[];
    });
  }

  async deleteProjectRecords(projectId: string): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([RASTERS, DOCUMENTS, META], 'readwrite');
      const rasters = transaction.objectStore(RASTERS);
      const documents = transaction.objectStore(DOCUMENTS);
      const meta = transaction.objectStore(META);
      const prefix = `${projectId}:`;

      const rasterRequest = rasters.getAllKeys();
      rasterRequest.onsuccess = () => {
        const keys = (rasterRequest.result as string[]).filter((key) => key.startsWith(prefix));
        for (const key of keys) {
          rasters.delete(key);
        }
        documents.delete(projectId);
        meta.delete(projectId);
      };
      rasterRequest.onerror = () => reject(rasterRequest.error ?? new Error('raster key scan failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('deleteProjectRecords failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('deleteProjectRecords aborted'));
    });
  }
}

let defaultDb: StorageDatabase | null = null;

export function getDefaultStorageDatabase(): StorageDatabase {
  if (!defaultDb) {
    defaultDb = new BrowserStorageDatabase();
  }
  return defaultDb;
}

export function setDefaultStorageDatabase(db: StorageDatabase | null): void {
  defaultDb = db;
}

export { openBrowserDatabase };
