import { cloneEditorDocument } from './editorDocument';
import { collectRasterIds } from './rasterIds';
import { APP_SETTINGS_META_ID, DB_NAME, DB_VERSION, type EditorDocument, type ProjectMeta } from './types';

export type ProjectExportSnapshot = {
  document: EditorDocument;
  rasters: Map<string, ArrayBuffer>;
};

export type ProjectImportPayload = {
  document: EditorDocument;
  rasters: ReadonlyMap<string, ArrayBuffer>;
  meta: ProjectMeta;
};

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

  readProjectExportSnapshot(projectId: string): Promise<ProjectExportSnapshot | null>;
  importProjectAtomic(payload: ProjectImportPayload): Promise<void>;
}

export type DeleteProjectRecordsOptions = {
  projectId: string;
};

const META = 'meta';
const DOCUMENTS = 'documents';
const RASTERS = 'rasters';

const REQUIRED_STORES: StoreName[] = [META, DOCUMENTS, RASTERS];

function projectMetaOnly(items: ProjectMeta[]): ProjectMeta[] {
  return items.filter((item) => item.id !== APP_SETTINGS_META_ID);
}

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

/** First meta read must start in `indexedDB.open` onsuccess (Safari hangs later transactions). */
let metaWarmup: Promise<ProjectMeta[]> | null = null;

function warmupMeta(db: IDBDatabase): Promise<ProjectMeta[]> {
  return new Promise((resolve, reject) => {
    const items: ProjectMeta[] = [];
    const transaction = db.transaction([META], 'readonly');
    const request = transaction.objectStore(META).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        items.push(cursor.value as ProjectMeta);
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error ?? new Error('idb warmup cursor failed'));
    transaction.oncomplete = () => resolve(items);
    transaction.onerror = () => reject(transaction.error ?? new Error('idb warmup failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('idb warmup aborted'));
  });
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
      db.onversionchange = () => {
        db.close();
      };
      if (hasRequiredStores(db)) {
        metaWarmup = warmupMeta(db);
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

/** Safari: never await inside a transaction; resolve on `oncomplete`, not request success. */
function tx<T>(
  db: IDBDatabase,
  storeNames: StoreName[],
  mode: IDBTransactionMode,
  run: (stores: Record<StoreName, IDBObjectStore>) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    const stores = {} as Record<StoreName, IDBObjectStore>;
    for (const name of storeNames) {
      stores[name] = transaction.objectStore(name);
    }
    let request: IDBRequest<T>;
    try {
      request = run(stores);
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    request.onerror = () => fail(request.error ?? new Error('idb request failed'));
    transaction.oncomplete = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(request.result);
    };
    transaction.onerror = () => fail(transaction.error ?? new Error('idb transaction failed'));
    transaction.onabort = () => fail(transaction.error ?? new Error('idb transaction aborted'));
  });
}

/** Safari `getAll` / `getAllKeys` can hang; walk with a cursor instead. */
function collectStore<T>(
  db: IDBDatabase,
  storeName: StoreName,
  pick: (cursor: IDBCursorWithValue) => T,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const results: T[] = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(pick(cursor));
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error ?? new Error('idb cursor failed'));
    transaction.oncomplete = () => resolve(results);
    transaction.onerror = () => reject(transaction.error ?? new Error('idb transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('idb transaction aborted'));
  });
}

async function rasterToArrayBuffer(value: unknown): Promise<ArrayBuffer | undefined> {
  if (value == null) {
    return undefined;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.arrayBuffer();
  }
  return rasterValueToArrayBuffer(value);
}

function rasterValueToArrayBuffer(value: unknown): ArrayBuffer | undefined {
  if (value == null) {
    return undefined;
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  if (typeof value === 'object' && value !== null && 'png' in value) {
    return rasterValueToArrayBuffer((value as { png: unknown }).png);
  }
  return undefined;
}

export class BrowserStorageDatabase implements StorageDatabase {
  private dbPromise: Promise<IDBDatabase>;
  private connection: IDBDatabase | null = null;

  constructor(dbPromise?: Promise<IDBDatabase>) {
    this.dbPromise = (dbPromise ?? openBrowserDatabase()).then((db) => {
      this.connection = db;
      return db;
    });
  }

  close(): void {
    this.connection?.close();
    this.connection = null;
    void this.dbPromise
      .then((db) => {
        db.close();
      })
      .catch(() => {});
  }

  private async db(): Promise<IDBDatabase> {
    return this.dbPromise;
  }

  async listMeta(): Promise<ProjectMeta[]> {
    const db = await this.db();
    const pending = metaWarmup;
    metaWarmup = null;
    if (pending) {
      try {
        return projectMetaOnly(await pending);
      } catch {
        return projectMetaOnly(await collectStore(db, META, (cursor) => cursor.value as ProjectMeta));
      }
    }
    return projectMetaOnly(await collectStore(db, META, (cursor) => cursor.value as ProjectMeta));
  }

  async getMeta(id: string): Promise<ProjectMeta | undefined> {
    const db = await this.db();
    const value = await tx(db, [META], 'readonly', ({ meta }) => meta.get(id));
    return value as ProjectMeta | undefined;
  }

  async putMeta(meta: ProjectMeta): Promise<void> {
    const db = await this.db();
    await tx(db, [META], 'readwrite', ({ meta: store }) => store.put(meta));
  }

  async deleteMeta(id: string): Promise<void> {
    const db = await this.db();
    await tx(db, [META], 'readwrite', ({ meta: store }) => store.delete(id));
  }

  async getDocument(id: string): Promise<EditorDocument | undefined> {
    const db = await this.db();
    const stored = await tx(db, [DOCUMENTS], 'readonly', ({ documents }) => documents.get(id));
    if (!stored) {
      return undefined;
    }
    const { id: _key, ...doc } = stored as EditorDocument & { id: string };
    return { ...doc, projectId: stored.id ?? doc.projectId } as EditorDocument;
  }

  async putDocument(doc: EditorDocument): Promise<void> {
    const db = await this.db();
    await tx(db, [DOCUMENTS], 'readwrite', ({ documents }) =>
      documents.put({ ...doc, id: doc.projectId }),
    );
  }

  async deleteDocument(id: string): Promise<void> {
    const db = await this.db();
    await tx(db, [DOCUMENTS], 'readwrite', ({ documents }) => documents.delete(id));
  }

  async getRaster(rasterId: string): Promise<ArrayBuffer | undefined> {
    const db = await this.db();
    const stored = await tx(db, [RASTERS], 'readonly', ({ rasters }) => rasters.get(rasterId));
    return rasterToArrayBuffer(stored);
  }

  async putRaster(rasterId: string, png: ArrayBuffer): Promise<void> {
    const db = await this.db();
    await tx(db, [RASTERS], 'readwrite', ({ rasters }) => rasters.put({ rasterId, png }));
  }

  async deleteRaster(rasterId: string): Promise<void> {
    const db = await this.db();
    await tx(db, [RASTERS], 'readwrite', ({ rasters }) => rasters.delete(rasterId));
  }

  async listRasterIds(): Promise<string[]> {
    const db = await this.db();
    return collectStore(db, RASTERS, (cursor) => cursor.key as string);
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

  async readProjectExportSnapshot(projectId: string): Promise<ProjectExportSnapshot | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([DOCUMENTS, RASTERS], 'readonly');
      const documents = transaction.objectStore(DOCUMENTS);
      const rasters = transaction.objectStore(RASTERS);
      const docRequest = documents.get(projectId);

      docRequest.onsuccess = () => {
        const stored = docRequest.result as (EditorDocument & { id: string }) | undefined;
        if (!stored) {
          resolve(null);
          return;
        }
        const { id: _key, ...docFields } = stored;
        const document = { ...docFields, projectId: stored.id ?? docFields.projectId } as EditorDocument;
        const rasterIds = collectRasterIds(document);
        const rasterMap = new Map<string, ArrayBuffer>();
        if (rasterIds.length === 0) {
          resolve({ document: cloneEditorDocument(document), rasters: rasterMap });
          return;
        }
        let pending = rasterIds.length;
        for (const rasterId of rasterIds) {
          const rasterRequest = rasters.get(rasterId);
          rasterRequest.onsuccess = () => {
            const png = rasterValueToArrayBuffer(rasterRequest.result);
            if (png) {
              rasterMap.set(rasterId, png);
            }
            pending -= 1;
            if (pending === 0) {
              resolve({ document: cloneEditorDocument(document), rasters: rasterMap });
            }
          };
          rasterRequest.onerror = () => reject(rasterRequest.error ?? new Error('raster read failed'));
        }
      };
      docRequest.onerror = () => reject(docRequest.error ?? new Error('document read failed'));
      transaction.onerror = () => reject(transaction.error ?? new Error('export snapshot failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('export snapshot aborted'));
    });
  }

  async importProjectAtomic(payload: ProjectImportPayload): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([RASTERS, DOCUMENTS, META], 'readwrite');
      const rasters = transaction.objectStore(RASTERS);
      const documents = transaction.objectStore(DOCUMENTS);
      const meta = transaction.objectStore(META);

      for (const [rasterId, png] of payload.rasters.entries()) {
        rasters.put({ rasterId, png: png.slice(0) });
      }
      documents.put({ ...payload.document, id: payload.document.projectId });
      meta.put(payload.meta);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('importProjectAtomic failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('importProjectAtomic aborted'));
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
  if (!db) {
    metaWarmup = null;
  }
}

/** Close the shared IndexedDB connection so the next page can open a fresh one (Safari). */
export function releaseDefaultStorageDatabase(): void {
  const current = defaultDb;
  defaultDb = null;
  metaWarmup = null;
  if (current instanceof BrowserStorageDatabase) {
    current.close();
  }
}

export { openBrowserDatabase };
