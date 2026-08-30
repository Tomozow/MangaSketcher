import { ipadDebugLog } from '../web/ipadDebugLog';
import { DB_NAME, DB_VERSION, type EditorDocument, type ProjectMeta } from './types';

// #region agent log
const AGENT_DEBUG_INGEST = 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426';
let inflightTx = 0;
let idbRejectHookInstalled = false;

function serializeIdbErr(err: unknown): Record<string, unknown> {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; code?: unknown };
    return { name: String(e.name ?? ''), message: String(e.message ?? err), code: e.code ?? null };
  }
  return { name: '', message: String(err), code: null };
}

function dbgIdb(hypothesisId: string, location: string, message: string, data?: Record<string, unknown>): void {
  ipadDebugLog({
    sessionId: '092972',
    ingest: AGENT_DEBUG_INGEST,
    hypothesisId,
    location,
    message,
    data: { inflightTx, ...data },
    timestamp: Date.now(),
  });
}

function installIdbRejectHook(): void {
  if (idbRejectHookInstalled || typeof window === 'undefined') {
    return;
  }
  idbRejectHookInstalled = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    if (
      message.includes('in-progress transaction') ||
      message.includes('Indexed') ||
      message.includes('UnknownError') ||
      (reason && typeof reason === 'object' && (reason as { name?: string }).name === 'UnknownError')
    ) {
      dbgIdb('D', 'idb.ts:unhandledrejection', 'idb unhandledrejection', serializeIdbErr(reason));
    }
  });
}

function attachDbLifetimeLogs(db: IDBDatabase): void {
  db.addEventListener('close', () => {
    dbgIdb('B', 'idb.ts:onclose', 'idb connection closed', { name: db.name, version: db.version });
  });
  db.addEventListener('versionchange', () => {
    dbgIdb('B', 'idb.ts:onversionchange', 'idb versionchange', { name: db.name, version: db.version });
  });
}
// #endregion

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

const REQUIRED_STORES: StoreName[] = [META, DOCUMENTS, RASTERS];

function ensureObjectStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(META)) {
    db.createObjectStore(META, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(DOCUMENTS)) {
    db.createObjectStore(DOCUMENTS, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(RASTERS)) {
    db.createObjectStore(RASTERS, { keyPath: 'rasterId' });
  }
}

function hasRequiredStores(db: IDBDatabase): boolean {
  return REQUIRED_STORES.every((name) => db.objectStoreNames.contains(name));
}

function openBrowserDatabase(allowReset = true): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
    request.onupgradeneeded = () => {
      ensureObjectStores(request.result);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (hasRequiredStores(db)) {
        // #region agent log
        installIdbRejectHook();
        attachDbLifetimeLogs(db);
        dbgIdb('B', 'idb.ts:open', 'idb opened', { name: db.name, version: db.version });
        // #endregion
        resolve(db);
        return;
      }
      db.close();
      if (!allowReset) {
        reject(new Error('IndexedDB is missing required object stores'));
        return;
      }
      const del = indexedDB.deleteDatabase(DB_NAME);
      del.onerror = () => reject(del.error ?? new Error('indexedDB.deleteDatabase failed'));
      del.onsuccess = () => {
        openBrowserDatabase(false).then(resolve, reject);
      };
    };
  });
}

function tx<T>(
  db: IDBDatabase,
  storeNames: StoreName[],
  mode: IDBTransactionMode,
  run: (stores: Record<StoreName, IDBObjectStore>) => Promise<T> | T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    inflightTx += 1;
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(storeNames, mode);
    } catch (err) {
      inflightTx -= 1;
      // #region agent log
      dbgIdb('B', 'idb.ts:tx:create', 'db.transaction threw', { storeNames, mode, ...serializeIdbErr(err) });
      // #endregion
      reject(err);
      return;
    }
    const stores = {} as Record<StoreName, IDBObjectStore>;
    for (const name of storeNames) {
      stores[name] = transaction.objectStore(name);
    }
    const fail = (err: unknown, where: string) => {
      // #region agent log
      dbgIdb('E', `idb.ts:tx:${where}`, 'idb tx failed', { storeNames, mode, ...serializeIdbErr(err) });
      // #endregion
      reject(err);
    };
    Promise.resolve(run(stores))
      .then((value) => {
        inflightTx -= 1;
        resolve(value);
      })
      .catch((err) => {
        inflightTx -= 1;
        fail(err, 'run');
      });
    transaction.onerror = () => fail(transaction.error ?? new Error('idb transaction failed'), 'onerror');
    transaction.onabort = () => fail(transaction.error ?? new Error('idb transaction aborted'), 'onabort');
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      // #region agent log
      dbgIdb('E', 'idb.ts:req', 'idb request failed', serializeIdbErr(request.error));
      // #endregion
      reject(request.error ?? new Error('idb request failed'));
    };
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
    try {
      await tx(db, [RASTERS], 'readwrite', async ({ rasters }) => {
        await req(rasters.put({ rasterId, png }));
      });
    } catch (err) {
      // #region agent log
      dbgIdb('D', 'idb.ts:putRaster', 'putRaster failed', { rasterId, byteLength: png.byteLength, ...serializeIdbErr(err) });
      // #endregion
      throw err;
    }
  }

  async deleteRaster(rasterId: string): Promise<void> {
    const db = await this.db();
    try {
      await tx(db, [RASTERS], 'readwrite', async ({ rasters }) => {
        await req(rasters.delete(rasterId));
      });
    } catch (err) {
      // #region agent log
      dbgIdb('C', 'idb.ts:deleteRaster', 'deleteRaster failed', { rasterId, ...serializeIdbErr(err) });
      // #endregion
      throw err;
    }
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
      const prefix = `${projectId}:`;
      // #region agent log
      dbgIdb('A', 'idb.ts:deleteProjectRecords:start', 'deleteProjectRecords start', { projectId });
      // #endregion
      inflightTx += 1;
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction([RASTERS, DOCUMENTS, META], 'readwrite');
      } catch (err) {
        inflightTx -= 1;
        // #region agent log
        dbgIdb('B', 'idb.ts:deleteProjectRecords:create', 'deleteProjectRecords tx create threw', {
          projectId,
          ...serializeIdbErr(err),
        });
        // #endregion
        reject(err);
        return;
      }
      const rasters = transaction.objectStore(RASTERS);
      const documents = transaction.objectStore(DOCUMENTS);
      const meta = transaction.objectStore(META);

      const rasterRequest = rasters.getAllKeys();
      rasterRequest.onsuccess = () => {
        const allKeys = rasterRequest.result as string[];
        const keys = allKeys.filter((key) => key.startsWith(prefix));
        // #region agent log
        dbgIdb('A', 'idb.ts:deleteProjectRecords:keys', 'deleteProjectRecords keys', {
          projectId,
          totalKeys: allKeys.length,
          matching: keys.length,
        });
        // #endregion
        try {
          for (const key of keys) {
            rasters.delete(key);
          }
          documents.delete(projectId);
          meta.delete(projectId);
        } catch (err) {
          // #region agent log
          dbgIdb('A', 'idb.ts:deleteProjectRecords:delete', 'delete after getAllKeys threw', {
            projectId,
            matching: keys.length,
            ...serializeIdbErr(err),
          });
          // #endregion
          reject(err);
        }
      };
      rasterRequest.onerror = () => reject(rasterRequest.error ?? new Error('raster key scan failed'));
      transaction.oncomplete = () => {
        inflightTx -= 1;
        resolve();
      };
      transaction.onerror = () => {
        inflightTx -= 1;
        // #region agent log
        dbgIdb('A', 'idb.ts:deleteProjectRecords:onerror', 'deleteProjectRecords tx error', {
          projectId,
          ...serializeIdbErr(transaction.error),
        });
        // #endregion
        reject(transaction.error ?? new Error('deleteProjectRecords failed'));
      };
      transaction.onabort = () => {
        inflightTx -= 1;
        // #region agent log
        dbgIdb('A', 'idb.ts:deleteProjectRecords:onabort', 'deleteProjectRecords tx abort', {
          projectId,
          ...serializeIdbErr(transaction.error),
        });
        // #endregion
        reject(transaction.error ?? new Error('deleteProjectRecords aborted'));
      };
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
