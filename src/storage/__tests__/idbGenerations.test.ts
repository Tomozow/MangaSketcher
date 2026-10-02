import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, test } from 'vitest';

import { createEditorDocument, sequentialIds } from '../../domain/document';
import { loadEditorBoot } from '../editorBoot';
import { documentRasterKey } from '../generationSnapshot';
import { BrowserStorageDatabase, PRE_V3_DOCUMENTS } from '../idb';
import { runStartupGc } from '../projectStore';
import { MemoryOpfsStorage } from '../testUtils/memoryOpfs';
import { DB_NAME, type EditorDocument, type ProjectMeta } from '../types';

// fake-indexeddb does not reproduce Safari's quirks (hung transactions, quota, closing on pagehide);
// this covers the transaction logic only.

function png(tag: number): ArrayBuffer {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag]).buffer;
}

const doc = (name = 'n') =>
  ({ ...createEditorDocument({ projectId: 'p', name: 'n', pageCount: 2, rasterWidth: 8, rasterHeight: 8, ids: sequentialIds('x') }), name }) as EditorDocument;
const meta = (d: EditorDocument): ProjectMeta => ({ id: d.projectId, name: d.name, updatedAt: 'x', pageCount: 2 });
const [A, B] = Object.values(doc().pages).map((page) => page.rasterId) as [string, string];

async function liveRaster(db: BrowserStorageDatabase, rasterId: string) {
  const stored = (await db.getDocument('p'))!;
  return db.getRaster(documentRasterKey(stored, rasterId));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('BrowserStorageDatabase generations', () => {
  test('a commit stores PNG revisions and the document that references them', async () => {
    const db = new BrowserStorageDatabase();
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(1)], [B, png(2)]]) });
    const stored = (await db.getDocument('p'))!;
    expect(stored.generation).toBe(1);
    expect(stored.rasterRevs).toEqual({ [A]: 1, [B]: 1 });
    expect(new Uint8Array((await liveRaster(db, A))!)).toEqual(new Uint8Array(png(1)));
    expect((await db.getMeta('p'))?.name).toBe('n');
    expect(await db.getSnapshotDocument('p')).toBeUndefined();
  });

  test('only changed rasters get a new revision; two generations are kept, older revisions go', async () => {
    const db = new BrowserStorageDatabase();
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(1)], [B, png(2)]]) });
    await db.commitDocumentGeneration({ document: doc('2'), meta: meta(doc('2')), rasters: new Map([[A, png(3)]]) });
    expect((await db.getDocument('p'))!.rasterRevs).toEqual({ [A]: 2, [B]: 1 });
    expect((await db.getSnapshotDocument('p'))!.name).toBe('n');
    expect((await db.listRasterIds()).sort()).toEqual([`${A}@1`, `${A}@2`, `${B}@1`].sort());

    await db.commitDocumentGeneration({ document: doc('3'), meta: meta(doc('3')), rasters: new Map([[A, png(4)]]) });
    expect((await db.listRasterIds()).sort()).toEqual([`${A}@2`, `${A}@3`, `${B}@1`].sort());
    expect((await db.getSnapshotDocument('p'))!.name).toBe('2');
  });

  test('a payload that is not a PNG aborts the whole commit', async () => {
    const db = new BrowserStorageDatabase();
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(1)], [B, png(2)]]) });
    await expect(
      db.commitDocumentGeneration({
        document: doc('bad'),
        meta: meta(doc('bad')),
        rasters: new Map([[A, png(9)], [B, new ArrayBuffer(4)]]),
      }),
    ).rejects.toThrow(/not a PNG/);
    expect((await db.getDocument('p'))!.name).toBe('n');
    expect((await db.listRasterIds()).sort()).toEqual([`${A}@1`, `${B}@1`].sort());
  });

  test('a write failing part-way leaves the previous generation whole', async () => {
    const db = new BrowserStorageDatabase();
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(1)], [B, png(2)]]) });
    // The meta put is the last write of the transaction; a record without its key makes it throw.
    await expect(
      db.commitDocumentGeneration({
        document: doc('half'),
        meta: { name: 'half' } as unknown as ProjectMeta,
        rasters: new Map([[A, png(5)]]),
      }),
    ).rejects.toBeDefined();
    const stored = (await db.getDocument('p'))!;
    expect(stored.name).toBe('n');
    expect(stored.generation).toBe(1);
    expect((await db.listRasterIds()).sort()).toEqual([`${A}@1`, `${B}@1`].sort());
    expect(await db.getSnapshotDocument('p')).toBeUndefined();
    const boot = await loadEditorBoot('p', { db, opfs: new MemoryOpfsStorage() });
    expect(new Uint8Array(boot!.encodedPng.get(A)!)).toEqual(new Uint8Array(png(1)));
  });

  test('a database from before revisions is used in place: nothing copied, nothing deleted', async () => {
    const db = new BrowserStorageDatabase();
    await db.putDocument(doc('old'));
    await db.putMeta(meta(doc('old')));
    await db.putRaster(A, png(1));
    await db.putRaster(B, png(2));

    const boot = await loadEditorBoot('p', { db, opfs: new MemoryOpfsStorage() });
    expect(new Uint8Array(boot!.encodedPng.get(B)!)).toEqual(new Uint8Array(png(2)));

    for (const tag of [3, 4, 5]) {
      await db.commitDocumentGeneration({ document: doc('new'), meta: meta(doc('new')), rasters: new Map([[A, png(tag)]]) });
    }
    expect((await db.listRasterIds()).sort()).toEqual([A, B, `${A}@2`, `${A}@3`].sort());
    expect(new Uint8Array((await liveRaster(db, A))!)).toEqual(new Uint8Array(png(5)));
    expect(new Uint8Array((await liveRaster(db, B))!)).toEqual(new Uint8Array(png(2)));
  });

  test('export snapshot resolves revisions and returns a document without them', async () => {
    const db = new BrowserStorageDatabase();
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(1)], [B, png(2)]]) });
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(3)]]) });
    const snapshot = (await db.readProjectExportSnapshot('p'))!;
    expect(new Uint8Array(snapshot.rasters.get(A)!)).toEqual(new Uint8Array(png(3)));
    expect(new Uint8Array(snapshot.rasters.get(B)!)).toEqual(new Uint8Array(png(2)));
    expect(snapshot.document.rasterRevs).toBeUndefined();
    expect(snapshot.document.generation).toBeUndefined();
  });

  test('deleting a project removes every revision', async () => {
    const db = new BrowserStorageDatabase();
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(1)], [B, png(2)]]) });
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(3)]]) });
    await db.deleteProjectRecords('p');
    expect(await db.listRasterIds()).toEqual([]);
    expect(await db.getDocument('p')).toBeUndefined();
    expect(await db.getSnapshotDocument('p')).toBeUndefined();
  });

  test('the database name is unchanged', () => {
    expect(DB_NAME).toBe('mangasketcher');
  });
});

const V2_STORES = ['meta', 'documents', 'rasters', 'documentSnapshots', 'rasterSnapshots'] as const;
type V2Rows = Partial<Record<(typeof V2_STORES)[number], object[]>>;

/** The stores and rows a version-2 build left behind; closed so the next open upgrades it. */
function seedV2(rows: V2Rows): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      for (const name of V2_STORES) {
        request.result.createObjectStore(name, { keyPath: name.startsWith('raster') ? 'rasterId' : 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([...V2_STORES], 'readwrite');
      for (const name of V2_STORES) {
        for (const row of rows[name] ?? []) {
          transaction.objectStore(name).put(row);
        }
      }
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

function readPreV3(source: string): Promise<(EditorDocument & { id: string }) | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction([PRE_V3_DOCUMENTS]).objectStore(PRE_V3_DOCUMENTS).get([source, 'p']);
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  });
}

const v2Doc = (name: string) => ({ ...doc(name), id: 'p' });
const bytes = (buffer: ArrayBuffer | undefined) => new Uint8Array(buffer!);

describe('upgrade from a version-2 database', () => {
  test('opens in place, keeps saving across GC and reloads, and keeps the pre-migration rows', async () => {
    await seedV2({
      meta: [meta(doc('live'))],
      documents: [v2Doc('live')],
      rasters: [{ rasterId: A, png: png(1) }, { rasterId: B, png: png(2) }],
      documentSnapshots: [v2Doc('snap')],
      rasterSnapshots: [{ rasterId: A, png: png(7) }, { rasterId: B, png: png(8) }],
    });
    const db = new BrowserStorageDatabase();
    const opfs = new MemoryOpfsStorage();

    const boot = (await loadEditorBoot('p', { db, opfs }))!;
    expect(boot.document.name).toBe('live');
    expect(bytes(boot.encodedPng.get(A))).toEqual(bytes(png(1)));

    for (const tag of [3, 4, 5]) {
      const next = { ...boot.document, name: `gen${tag}` };
      await db.commitDocumentGeneration({ document: next, meta: meta(next), rasters: new Map([[A, png(tag)]]) });
      await runStartupGc({ db, opfs });
    }

    const reboot = (await loadEditorBoot('p', { db, opfs }))!;
    expect(reboot.document.name).toBe('gen5');
    expect(bytes(reboot.encodedPng.get(A))).toEqual(bytes(png(5)));
    expect(bytes(reboot.encodedPng.get(B))).toEqual(bytes(png(2)));
    const pack = (await db.readProjectExportSnapshot('p'))!;
    expect(bytes(pack.rasters.get(A))).toEqual(bytes(png(5)));
    expect(bytes(pack.rasters.get(B))).toEqual(bytes(png(2)));

    // Everything the version-2 state needs is still there: both document rows and their PNGs.
    expect((await readPreV3('documents'))?.name).toBe('live');
    expect((await readPreV3('documentSnapshots'))?.name).toBe('snap');
    expect(bytes(await db.getRaster(A))).toEqual(bytes(png(1)));
    expect(bytes(await db.getSnapshotRaster(B))).toEqual(bytes(png(8)));

    await db.deleteProjectRecords('p');
    expect(await readPreV3('documents')).toBeUndefined();
    expect(await readPreV3('documentSnapshots')).toBeUndefined();
  });

  test('a torn version-2 live document boots from the version-2 fallback and saves on from it', async () => {
    await seedV2({
      meta: [meta(doc('live'))],
      documents: [v2Doc('live')],
      rasters: [{ rasterId: A, png: png(1) }],
      documentSnapshots: [v2Doc('snap')],
      rasterSnapshots: [{ rasterId: A, png: png(7) }, { rasterId: B, png: png(8) }],
    });
    const db = new BrowserStorageDatabase();
    const opfs = new MemoryOpfsStorage();

    const boot = (await loadEditorBoot('p', { db, opfs }))!;
    expect(boot.document.name).toBe('snap');
    expect(bytes(boot.encodedPng.get(A))).toEqual(bytes(png(7)));
    expect(bytes(boot.encodedPng.get(B))).toEqual(bytes(png(8)));

    const next = { ...boot.document, name: 'after' };
    await db.commitDocumentGeneration({ document: next, meta: meta(next), rasters: new Map([[A, png(9)]]) });
    await runStartupGc({ db, opfs });
    const reboot = (await loadEditorBoot('p', { db, opfs }))!;
    expect(reboot.document.name).toBe('after');
    expect(bytes(reboot.encodedPng.get(A))).toEqual(bytes(png(9)));
    expect(bytes(reboot.encodedPng.get(B))).toEqual(bytes(png(8)));
  });

  test('a database created at the current version gets the store but no rows', async () => {
    const db = new BrowserStorageDatabase();
    await db.commitDocumentGeneration({ document: doc(), meta: meta(doc()), rasters: new Map([[A, png(1)], [B, png(2)]]) });
    expect(await readPreV3('documents')).toBeUndefined();
  });
});
