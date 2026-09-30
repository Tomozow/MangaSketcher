import { AutosaveManager } from '../autosave';
import { loadEditorBoot } from '../editorBoot';
import { planGeneration, rasterToArrayBuffer, storedPngIsValid } from '../generationSnapshot';
import { clipRasterId, pdfBlobRasterId } from '../rasterIds';
import { createProject, renameProject, runStartupGc } from '../projectStore';
import { MemoryStorageDatabase } from '../testUtils/memoryDb';
import { MemoryOpfsStorage } from '../testUtils/memoryOpfs';
import type { EditorDocument } from '../types';

function pngBytes(tag: number): ArrayBuffer {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array(header.length + 1);
  bytes.set(header);
  bytes[8] = tag;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function notPng(): ArrayBuffer {
  return Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]).buffer;
}

const metaOf = (doc: EditorDocument) => ({
  id: doc.projectId,
  name: doc.name,
  updatedAt: 'x',
  pageCount: Object.keys(doc.pages).length,
});

/** Save a document that references a clip with no PNG. The previous generation stays whole. */
async function saveWithMissingClip(db: MemoryStorageDatabase, projectId: string): Promise<EditorDocument> {
  const doc = (await db.getDocument(projectId))!;
  doc.pasteboardClips = [
    ...doc.pasteboardClips,
    { id: 'ghost', rasterId: clipRasterId(projectId, 'ghost'), x: 0, y: 0, scale: 1, rotation: 0 },
  ];
  await db.commitDocumentGeneration({ document: doc, meta: metaOf(doc) });
  return doc;
}

describe('generations', () => {
  test('a save writes a new revision and keeps the previous generation as the fallback', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('two', 2, { db });
    const pageA = document.pages[document.workspaceOrder[0]!]!.rasterId;
    const blank = (await db.liveRaster(pageA))!;
    const encoded = new Map<string, ArrayBuffer>([[pageA, pngBytes(1)]]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    manager.scheduleSave({ ...document, name: 'drawn' }, [pageA]);
    await manager.flushRouteLeave();
    manager.dispose();

    const live = (await db.getDocument(document.projectId))!;
    const fallback = (await db.getSnapshotDocument(document.projectId))!;
    expect(live.name).toBe('drawn');
    expect(live.rasterRevs?.[pageA]).toBe(live.generation);
    expect(new Uint8Array((await db.liveRaster(pageA))!)).toEqual(new Uint8Array(pngBytes(1)));
    expect(fallback.name).toBe('two');
    expect(new Uint8Array((await db.getRaster(`${pageA}@${fallback.rasterRevs![pageA]}`))!)).toEqual(
      new Uint8Array(blank),
    );
  });

  test('revisions used by neither the live nor the fallback generation are deleted', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('gc', 1, { db });
    const page = document.pages[document.workspaceOrder[0]!]!.rasterId;
    for (const tag of [1, 2, 3]) {
      await db.commitDocumentGeneration({
        document,
        meta: metaOf(document),
        rasters: new Map([[page, pngBytes(tag)]]),
      });
    }
    const live = (await db.getDocument(document.projectId))!;
    expect((await db.listRasterIds()).sort()).toEqual([`${page}@${live.generation! - 1}`, `${page}@${live.generation}`]);
  });

  test('data from before revisions is read in place and never deleted', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('legacy', 1, { db });
    const page = document.pages[document.workspaceOrder[0]!]!.rasterId;
    // Shape of a pre-revision database: document without revisions, PNG under the raster id.
    db.rasters.clear();
    db.documentSnapshots.clear();
    db.documents.set(document.projectId, structuredClone(document));
    db.rasters.set(page, pngBytes(7));

    expect(new Uint8Array((await loadEditorBoot(document.projectId, { db, opfs: new MemoryOpfsStorage() }))!.encodedPng.get(page)!)).toEqual(
      new Uint8Array(pngBytes(7)),
    );
    for (const tag of [1, 2, 3]) {
      await db.commitDocumentGeneration({
        document,
        meta: metaOf(document),
        rasters: new Map([[page, pngBytes(tag)]]),
      });
    }
    expect(new Uint8Array((await db.getRaster(page))!)).toEqual(new Uint8Array(pngBytes(7)));
    expect(new Uint8Array((await db.liveRaster(page))!)).toEqual(new Uint8Array(pngBytes(3)));
  });

  test('a payload that is not a PNG fails the save and leaves the stored generation untouched', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('bad', 1, { db });
    const page = document.pages[document.workspaceOrder[0]!]!.rasterId;
    const before = structuredClone(await db.getDocument(document.projectId));
    const keys = await db.listRasterIds();
    await expect(
      db.commitDocumentGeneration({
        document: { ...document, name: 'never' },
        meta: metaOf(document),
        rasters: new Map([[page, notPng()]]),
      }),
    ).rejects.toThrow();
    expect(await db.getDocument(document.projectId)).toEqual(before);
    expect(await db.listRasterIds()).toEqual(keys);
  });

  test('revisions in the input document are ignored; storage assigns them', () => {
    const doc = { projectId: 'p', pages: { a: { id: 'a', rasterId: 'p:page:a', texts: [] } }, pasteboardClips: [] } as unknown as EditorDocument;
    const stored = { ...doc, generation: 4, rasterRevs: { 'p:page:a': 3 } };
    const plan = planGeneration(stored, undefined, { document: { ...doc, generation: 99, rasterRevs: { 'p:page:a': 98 } } });
    expect(plan.document.generation).toBe(5);
    expect(plan.document.rasterRevs).toEqual({ 'p:page:a': 3 });
  });

  test('a saved document whose raster has no PNG falls back to the previous generation on boot', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('restore', 1, { db, opfs });
    await saveWithMissingClip(db, document.projectId);
    expect((await db.getDocument(document.projectId))?.pasteboardClips).toHaveLength(1);

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot).not.toBeNull();
    expect(boot!.document.pasteboardClips).toHaveLength(0);
    expect(boot!.document.name).toBe('restore');
    expect(boot!.encodedPng.size).toBe(1);
    expect(storedPngIsValid([...boot!.encodedPng.values()][0])).toBe(true);
  });

  test('without a fallback the live document is kept as is', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('no-rollback', 1, { db, opfs });
    await saveWithMissingClip(db, document.projectId);
    db.documentSnapshots.clear();

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot).not.toBeNull();
    expect(boot!.document.pasteboardClips).toHaveLength(1);
    expect(boot!.encodedPng.has(clipRasterId(document.projectId, 'ghost'))).toBe(false);
  });

  test('meta-only with a good fallback restores and boots', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('meta-only', 1, { db, opfs });
    await renameProject(document.projectId, 'renamed', { db });
    await db.deleteDocument(document.projectId);
    expect(await db.getDocument(document.projectId)).toBeUndefined();
    expect(await db.getMeta(document.projectId)).toBeDefined();

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot).not.toBeNull();
    expect(boot!.document.projectId).toBe(document.projectId);
    expect(boot!.encodedPng.size).toBe(1);
  });

  test('a consistent live document wins over the fallback', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('stale', 1, { db, opfs });
    await renameProject(document.projectId, 'newer-live', { db });

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.name).toBe('newer-live');
    expect(boot?.encodedPng.size).toBe(1);
    expect((await db.getSnapshotDocument(document.projectId))?.name).toBe('stale');
  });

  test('startup GC keeps what the live and fallback generations use, then restore still works', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('gc-restore', 1, { db, opfs });
    await saveWithMissingClip(db, document.projectId);
    const keys = (await db.listRasterIds()).sort();
    db.rasters.set(`${document.projectId}:page:gone@1`, pngBytes(1));
    // A revision newer than the generation the GC read: a save racing the GC wrote it.
    db.rasters.set(`${document.projectId}:page:racing@9`, pngBytes(3));
    db.rasters.set(`${document.projectId}:clip:legacy-orphan`, pngBytes(2));
    await runStartupGc({ db, opfs });
    expect((await db.listRasterIds()).sort()).toEqual(
      [...keys, `${document.projectId}:clip:legacy-orphan`, `${document.projectId}:page:racing@9`].sort(),
    );
    db.rasters.delete(`${document.projectId}:page:racing@9`);

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.pasteboardClips).toHaveLength(0);
    expect(boot?.encodedPng.size).toBe(1);
  });

  test('pdf raster in rasters store does not trigger false restore', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('with-pdf', 1, { db, opfs });
    await db.putRaster(pdfBlobRasterId(document.projectId), Uint8Array.from([0x25, 0x50, 0x44, 0x46]).buffer);
    await renameProject(document.projectId, 'live-pdf', { db });
    await runStartupGc({ db, opfs });

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.name).toBe('live-pdf');
    expect(await db.getRaster(pdfBlobRasterId(document.projectId))).toBeDefined();
  });

  test('PNG signature rejects short buffers; Blob values are converted; a damaged live PNG falls back', async () => {
    expect(storedPngIsValid(new ArrayBuffer(4))).toBe(false);
    expect(storedPngIsValid(pngBytes(1))).toBe(true);
    const blob = new Blob([new Uint8Array(pngBytes(4))]);
    const converted = await rasterToArrayBuffer(blob);
    expect(storedPngIsValid(converted)).toBe(true);

    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('blob', 1, { db, opfs });
    const rasterId = document.pages[document.workspaceOrder[0]!]!.rasterId;
    await db.commitDocumentGeneration({
      document,
      meta: metaOf(document),
      rasters: new Map([[rasterId, pngBytes(5)]]),
    });
    db.setLiveRaster(rasterId, new Blob([new Uint8Array(pngBytes(5))]));
    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.encodedPng.get(rasterId)?.byteLength).toBeGreaterThan(7);

    db.setLiveRaster(rasterId, new Blob([new Uint8Array(notPng())]));
    const restored = await loadEditorBoot(document.projectId, { db, opfs });
    expect(restored?.document.projectId).toBe(document.projectId);
    expect(storedPngIsValid(restored?.encodedPng.get(rasterId))).toBe(true);
    expect(storedPngIsValid(await db.liveRaster(rasterId))).toBe(true);
  });

  test('meta missing with live document does not restore', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('no-meta', 1, { db, opfs });
    await saveWithMissingClip(db, document.projectId);
    await db.deleteMeta(document.projectId);
    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.pasteboardClips).toHaveLength(1);
  });
});
