import { cloneEditorDocument } from './editorDocument';
import {
  DOCUMENT_SNAPSHOTS,
  RASTER_SNAPSHOTS,
  isQuotaExceededError,
  rasterToArrayBuffer,
  rasterValueToArrayBuffer,
  snapshotGuardPasses,
  snapshotRastersToPut,
  storedPngIsValid,
  stripStoredDocument,
  type CommitDocumentGenerationInput,
  type CommitDocumentGenerationResult,
} from './generationSnapshot';
import { collectRasterIds } from './rasterIds';
import { APP_SETTINGS_META_ID, DB_NAME, DB_VERSION, type EditorDocument, type ProjectMeta } from './types';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

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
export type DocumentSnapshotsStore = 'documentSnapshots';
export type RasterSnapshotsStore = 'rasterSnapshots';

export type LiveStoreName = MetaStore | DocumentsStore | RastersStore;
export type StoreName = LiveStoreName | DocumentSnapshotsStore | RasterSnapshotsStore;

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

  getSnapshotDocument(id: string): Promise<EditorDocument | undefined>;
  getSnapshotRaster(rasterId: string): Promise<ArrayBuffer | undefined>;
  listSnapshotRasterIds(): Promise<string[]>;

  commitDocumentGeneration(input: CommitDocumentGenerationInput): Promise<CommitDocumentGenerationResult>;

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

/** Wipe-set for missing-schema deleteDatabase. Snapshot stores must NOT be listed. */
export const REQUIRED_STORES: LiveStoreName[] = [META, DOCUMENTS, RASTERS];

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
  // v2: empty snapshot stores only. Do not copy live PNGs (iPad quota).
  if (!db.objectStoreNames.contains(DOCUMENT_SNAPSHOTS)) {
    db.createObjectStore(DOCUMENT_SNAPSHOTS, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(RASTER_SNAPSHOTS)) {
    db.createObjectStore(RASTER_SNAPSHOTS, { keyPath: 'rasterId' });
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
    request.onblocked = () => {
      ipadDebugLog({
        sessionId: 'gen-snap',
        hypothesisId: 'GS3',
        location: 'idb.ts:openBrowserDatabase',
        message: 'indexedDB.open blocked (another tab holds an older version)',
      });
    };
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
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(storeNames, mode);
    } catch (err) {
      // #region agent log
      ipadDebugLog({
        sessionId: 'adcc47',
        ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
        hypothesisId: 'F',
        location: 'idb.ts:tx',
        message: 'db.transaction threw',
        data: {
          name: err instanceof Error ? err.name : typeof err,
          msg: err instanceof Error ? err.message : String(err),
          mode,
        },
      });
      // #endregion
      reject(err);
      return;
    }
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

function readRawRecords(
  db: IDBDatabase,
  storeName: StoreName,
  keys: readonly string[],
): Promise<Map<string, unknown>> {
  return new Promise((resolve, reject) => {
    const results = new Map<string, unknown>();
    if (keys.length === 0) {
      resolve(results);
      return;
    }
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        results.set(key, request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('idb get failed'));
    }
    transaction.oncomplete = () => resolve(results);
    transaction.onerror = () => reject(transaction.error ?? new Error('idb read failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('idb read aborted'));
  });
}

async function readRasterBytes(
  db: IDBDatabase,
  storeName: StoreName,
  keys: readonly string[],
): Promise<Map<string, ArrayBuffer>> {
  const raw = await readRawRecords(db, storeName, keys);
  const bytes = new Map<string, ArrayBuffer>();
  for (const [key, value] of raw) {
    const png = await rasterToArrayBuffer(value);
    if (png) {
      bytes.set(key, png);
    }
  }
  return bytes;
}

function deletePrefixWithCursor(
  store: IDBObjectStore,
  prefix: string,
  onDone: () => void,
  onFail: (error: unknown) => void,
): void {
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) {
      onDone();
      return;
    }
    if (String(cursor.key).startsWith(prefix)) {
      cursor.delete();
    }
    cursor.continue();
  };
  request.onerror = () => onFail(request.error ?? new Error('idb prefix cursor failed'));
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
      } catch (err) {
        // #region agent log
        ipadDebugLog({
          sessionId: 'adcc47',
          ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
          hypothesisId: 'A',
          location: 'idb.ts:listMeta',
          message: 'metaWarmup failed, falling back',
          data: {
            name: err instanceof Error ? err.name : typeof err,
            msg: err instanceof Error ? err.message : String(err),
          },
        });
        // #endregion
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
    return stripStoredDocument(stored);
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

  async getSnapshotDocument(id: string): Promise<EditorDocument | undefined> {
    const db = await this.db();
    if (!db.objectStoreNames.contains(DOCUMENT_SNAPSHOTS)) {
      return undefined;
    }
    const stored = await tx(db, [DOCUMENT_SNAPSHOTS], 'readonly', (stores) =>
      stores[DOCUMENT_SNAPSHOTS].get(id),
    );
    return stripStoredDocument(stored);
  }

  async getSnapshotRaster(rasterId: string): Promise<ArrayBuffer | undefined> {
    const db = await this.db();
    if (!db.objectStoreNames.contains(RASTER_SNAPSHOTS)) {
      return undefined;
    }
    const stored = await tx(db, [RASTER_SNAPSHOTS], 'readonly', (stores) =>
      stores[RASTER_SNAPSHOTS].get(rasterId),
    );
    return rasterToArrayBuffer(stored);
  }

  async listSnapshotRasterIds(): Promise<string[]> {
    const db = await this.db();
    if (!db.objectStoreNames.contains(RASTER_SNAPSHOTS)) {
      return [];
    }
    return collectStore(db, RASTER_SNAPSHOTS, (cursor) => cursor.key as string);
  }

  async commitDocumentGeneration(
    input: CommitDocumentGenerationInput,
  ): Promise<CommitDocumentGenerationResult> {
    const db = await this.db();
    const payload = input.rasters ?? new Map<string, ArrayBuffer>();
    const mode = input.snapshot ?? 'guarded';
    const rasterIds = collectRasterIds(input.document);
    const liveBefore = await readRasterBytes(db, RASTERS, rasterIds);

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([RASTERS, DOCUMENTS, META], 'readwrite');
      const rasters = transaction.objectStore(RASTERS);
      const documents = transaction.objectStore(DOCUMENTS);
      const meta = transaction.objectStore(META);
      for (const [rasterId, png] of payload.entries()) {
        rasters.put({ rasterId, png: png.slice(0) });
      }
      documents.put({ ...input.document, id: input.document.projectId });
      meta.put(input.meta);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('commit live failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('commit live aborted'));
    });

    if (mode === 'none') {
      return { snapshotUpdated: false };
    }

    try {
      if (mode === 'name-only') {
        const liveOk = rasterIds.every((id) => storedPngIsValid(payload.get(id) ?? liveBefore.get(id)));
        if (!liveOk) {
          return { snapshotUpdated: false };
        }
        const snapshotDoc = await this.getSnapshotDocument(input.document.projectId);
        if (!snapshotDoc) {
          return { snapshotUpdated: false };
        }
        snapshotDoc.name = input.document.name;
        await this.putSnapshotDocumentOnly(db, snapshotDoc);
        return { snapshotUpdated: true };
      }

      if (!snapshotGuardPasses(input.document, payload, liveBefore)) {
        return { snapshotUpdated: false };
      }

      const existingSnapshot = db.objectStoreNames.contains(RASTER_SNAPSHOTS)
        ? await readRasterBytes(db, RASTER_SNAPSHOTS, rasterIds)
        : new Map<string, ArrayBuffer>();
      const toPut = snapshotRastersToPut(input.document, payload, liveBefore, existingSnapshot);
      await this.commitSnapshotStores(db, input.document, toPut);
      return { snapshotUpdated: true };
    } catch (err) {
      ipadDebugLog({
        sessionId: 'gen-snap',
        hypothesisId: 'GS1',
        location: 'idb.ts:commitDocumentGeneration',
        message: 'snapshot write failed; live kept',
        data: {
          quota: isQuotaExceededError(err),
          name: err instanceof Error ? err.name : typeof err,
          msg: err instanceof Error ? err.message : String(err),
        },
      });
      return { snapshotUpdated: false };
    }
  }

  private putSnapshotDocumentOnly(db: IDBDatabase, document: EditorDocument): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(DOCUMENT_SNAPSHOTS)) {
        resolve();
        return;
      }
      const transaction = db.transaction([DOCUMENT_SNAPSHOTS], 'readwrite');
      transaction.objectStore(DOCUMENT_SNAPSHOTS).put({ ...document, id: document.projectId });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('snapshot document put failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('snapshot document put aborted'));
    });
  }

  private commitSnapshotStores(
    db: IDBDatabase,
    document: EditorDocument,
    rasters: ReadonlyMap<string, ArrayBuffer>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (
        !db.objectStoreNames.contains(DOCUMENT_SNAPSHOTS) ||
        !db.objectStoreNames.contains(RASTER_SNAPSHOTS)
      ) {
        resolve();
        return;
      }
      const transaction = db.transaction([DOCUMENT_SNAPSHOTS, RASTER_SNAPSHOTS], 'readwrite');
      const snapshotDocs = transaction.objectStore(DOCUMENT_SNAPSHOTS);
      const snapshotRasters = transaction.objectStore(RASTER_SNAPSHOTS);
      snapshotDocs.put({ ...document, id: document.projectId });
      for (const [rasterId, png] of rasters.entries()) {
        snapshotRasters.put({ rasterId, png: png.slice(0) });
      }
      const prefix = `${document.projectId}:`;
      const keep = new Set(collectRasterIds(document));
      const cursorRequest = snapshotRasters.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          return;
        }
        const key = String(cursor.key);
        if (key.startsWith(prefix) && !keep.has(key)) {
          cursor.delete();
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('snapshot raster cursor failed'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('commit snapshot failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('commit snapshot aborted'));
    });
  }

  async deleteProjectRecords(projectId: string): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const storeNames: StoreName[] = [RASTERS, DOCUMENTS, META];
      if (db.objectStoreNames.contains(DOCUMENT_SNAPSHOTS)) {
        storeNames.push(DOCUMENT_SNAPSHOTS);
      }
      if (db.objectStoreNames.contains(RASTER_SNAPSHOTS)) {
        storeNames.push(RASTER_SNAPSHOTS);
      }
      const transaction = db.transaction(storeNames, 'readwrite');
      const rasters = transaction.objectStore(RASTERS);
      const documents = transaction.objectStore(DOCUMENTS);
      const meta = transaction.objectStore(META);
      const snapshotRasters = db.objectStoreNames.contains(RASTER_SNAPSHOTS)
        ? transaction.objectStore(RASTER_SNAPSHOTS)
        : null;
      const snapshotDocs = db.objectStoreNames.contains(DOCUMENT_SNAPSHOTS)
        ? transaction.objectStore(DOCUMENT_SNAPSHOTS)
        : null;
      const prefix = `${projectId}:`;
      const fail = (error: unknown) => reject(error);

      deletePrefixWithCursor(
        rasters,
        prefix,
        () => {
          const afterSnapshotRasters = () => {
            documents.delete(projectId);
            snapshotDocs?.delete(projectId);
            meta.delete(projectId);
          };
          if (!snapshotRasters) {
            afterSnapshotRasters();
            return;
          }
          deletePrefixWithCursor(snapshotRasters, prefix, afterSnapshotRasters, fail);
        },
        fail,
      );

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
    await this.commitDocumentGeneration({
      document: payload.document,
      meta: payload.meta,
      rasters: payload.rasters,
      snapshot: 'guarded',
    });
  }
}

let defaultDb: StorageDatabase | null = null;
let defaultStorageReleased = false;

export function getDefaultStorageDatabase(): StorageDatabase {
  if (!defaultDb) {
    defaultDb = new BrowserStorageDatabase();
    defaultStorageReleased = false;
  }
  return defaultDb;
}

export function setDefaultStorageDatabase(db: StorageDatabase | null): void {
  defaultDb = db;
  defaultStorageReleased = db == null;
  if (!db) {
    metaWarmup = null;
  }
}

export function isDefaultStorageReleased(): boolean {
  return defaultStorageReleased;
}

/** Close the shared IndexedDB connection so the next page can open a fresh one (Safari). */
export function releaseDefaultStorageDatabase(): void {
  const current = defaultDb;
  defaultDb = null;
  metaWarmup = null;
  defaultStorageReleased = true;
  if (current instanceof BrowserStorageDatabase) {
    current.close();
  }
}

export { openBrowserDatabase, rasterToArrayBuffer, rasterValueToArrayBuffer };
