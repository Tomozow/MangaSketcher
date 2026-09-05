import { AutosaveManager } from '../autosave';
import { loadEditorBoot } from '../editorBoot';
import { rasterToArrayBuffer, storedPngIsValid } from '../generationSnapshot';
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

async function tearLiveMissingClip(db: MemoryStorageDatabase, projectId: string): Promise<EditorDocument> {
  const doc = (await db.getDocument(projectId))!;
  doc.pasteboardClips = [
    ...doc.pasteboardClips,
    { id: 'ghost', rasterId: clipRasterId(projectId, 'ghost'), x: 0, y: 0, scale: 1, rotation: 0 },
  ];
  await db.putDocument(doc);
  return doc;
}

describe('generation snapshots', () => {
  test('second executeJob updates only dirty snapshot rasters', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('two', 2, { db });
    const pageA = document.pages[document.workspaceOrder[0]!]!.rasterId;
    const pageB = document.pages[document.workspaceOrder[1]!]!.rasterId;
    const firstA = pngBytes(1);
    const secondB = pngBytes(2);
    const encoded = new Map<string, ArrayBuffer>([[pageA, firstA]]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    manager.scheduleSave(document, [pageA]);
    await manager.flushRouteLeave();
    encoded.set(pageB, secondB);
    manager.scheduleSave(document, [pageB]);
    await manager.flushRouteLeave();
    manager.dispose();

    expect(new Uint8Array((await db.getSnapshotRaster(pageA))!)).toEqual(new Uint8Array(firstA));
    expect(new Uint8Array((await db.getSnapshotRaster(pageB))!)).toEqual(new Uint8Array(secondB));
  });

  test('flushHidden does not update snapshot', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('idle', 1, { db });
    const snapshotName = (await db.getSnapshotDocument(document.projectId))!.name;
    const encoded = new Map<string, ArrayBuffer>([
      [document.pages[document.workspaceOrder[0]!]!.rasterId, pngBytes(9)],
    ]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    const pending = { ...document, name: 'hidden-name' };
    pending.pasteboardClips = [
      { id: 'c1', rasterId: clipRasterId(document.projectId, 'c1'), x: 1, y: 2, scale: 1, rotation: 0 },
    ];
    manager.scheduleSave(pending, [], false);
    manager.flushHidden();
    await Promise.resolve();
    manager.dispose();

    expect((await db.getDocument(document.projectId))?.name).toBe('hidden-name');
    expect((await db.getSnapshotDocument(document.projectId))?.name).toBe(snapshotName);
    expect((await db.getSnapshotDocument(document.projectId))?.pasteboardClips).toHaveLength(0);
  });

  test('executeJob with missing encoded dirty clip does not change snapshot document', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('encode-miss', 1, { db });
    const before = await db.getSnapshotDocument(document.projectId);
    const encoded = new Map<string, ArrayBuffer>();
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    const next = { ...document };
    next.pasteboardClips = [
      { id: 'c1', rasterId: clipRasterId(document.projectId, 'c1'), x: 0, y: 0, scale: 1, rotation: 0 },
    ];
    manager.scheduleSave(next, [clipRasterId(document.projectId, 'c1')]);
    await manager.flushRouteLeave();
    manager.dispose();

    expect((await db.getDocument(document.projectId))?.pasteboardClips).toHaveLength(1);
    expect((await db.getSnapshotDocument(document.projectId))?.pasteboardClips).toEqual(before?.pasteboardClips);
    expect((await db.getSnapshotDocument(document.projectId))?.name).toBe(before?.name);
  });

  test('torn live restores snapshot document on boot', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('restore', 1, { db, opfs });
    await tearLiveMissingClip(db, document.projectId);
    expect((await db.getDocument(document.projectId))?.pasteboardClips).toHaveLength(1);

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot).not.toBeNull();
    expect(boot!.document.pasteboardClips).toHaveLength(0);
    expect(boot!.document.name).toBe('restore');
    expect(boot!.encodedPng.size).toBe(1);
  });

  test('bad snapshot plus live document does not roll back', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('no-rollback', 1, { db, opfs });
    await tearLiveMissingClip(db, document.projectId);
    db.documentSnapshots.clear();
    db.rasterSnapshots.clear();

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot).not.toBeNull();
    expect(boot!.document.pasteboardClips).toHaveLength(1);
    expect(boot!.encodedPng.has(clipRasterId(document.projectId, 'ghost'))).toBe(false);
  });

  test('meta-only with good snapshot restores and boots', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('meta-only', 1, { db, opfs });
    await db.deleteDocument(document.projectId);
    expect(await db.getDocument(document.projectId)).toBeUndefined();
    expect(await db.getMeta(document.projectId)).toBeDefined();

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot).not.toBeNull();
    expect(boot!.document.projectId).toBe(document.projectId);
    expect(boot!.encodedPng.size).toBe(1);
  });

  test('consistent live with stale snapshot is not restored', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('stale', 1, { db, opfs });
    const live = (await db.getDocument(document.projectId))!;
    live.name = 'newer-live';
    await db.putDocument(live);
    await db.putMeta({
      id: live.projectId,
      name: live.name,
      updatedAt: '2026-09-05T00:00:00.000Z',
      pageCount: 1,
    });

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.name).toBe('newer-live');
    expect((await db.getSnapshotDocument(document.projectId))?.name).toBe('stale');
  });

  test('startup GC then restore still works', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('gc-restore', 1, { db, opfs });
    const snapshotKeys = await db.listSnapshotRasterIds();
    await tearLiveMissingClip(db, document.projectId);
    await runStartupGc({ db, opfs });
    expect(await db.listSnapshotRasterIds()).toEqual(snapshotKeys);

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.pasteboardClips).toHaveLength(0);
    expect(await db.listSnapshotRasterIds()).toEqual(snapshotKeys);
  });

  test('rename does not copy torn live onto snapshot', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('old-name', 1, { db });
    await tearLiveMissingClip(db, document.projectId);
    await renameProject(document.projectId, 'renamed', { db });

    expect((await db.getDocument(document.projectId))?.name).toBe('renamed');
    const snap = await db.getSnapshotDocument(document.projectId);
    expect(snap?.name).toBe('old-name');
    expect(snap?.pasteboardClips).toHaveLength(0);
  });

  test('QuotaExceeded on snapshot does not fail live and still clears unsaved', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('quota', 1, { db });
    db.failSnapshotQuota = true;
    const pageId = document.pages[document.workspaceOrder[0]!]!.rasterId;
    const encoded = new Map<string, ArrayBuffer>([[pageId, pngBytes(3)]]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    const next = { ...document, name: 'after-quota' };
    manager.scheduleSave(next, [pageId]);
    await manager.flushRouteLeave();
    expect(manager.getStatus().unsaved).toBe(false);
    manager.dispose();

    expect((await db.getDocument(document.projectId))?.name).toBe('after-quota');
    expect((await db.getSnapshotDocument(document.projectId))?.name).toBe('quota');
  });

  test('pdf raster in rasters store does not trigger false restore', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('with-pdf', 1, { db, opfs });
    await db.putRaster(pdfBlobRasterId(document.projectId), Uint8Array.from([0x25, 0x50, 0x44, 0x46]).buffer);
    const live = (await db.getDocument(document.projectId))!;
    live.name = 'live-pdf';
    await db.putDocument(live);

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.name).toBe('live-pdf');
  });

  test('PNG signature rejects short buffers; Blob values are converted outside tx', async () => {
    expect(storedPngIsValid(new ArrayBuffer(4))).toBe(false);
    expect(storedPngIsValid(pngBytes(1))).toBe(true);
    const blob = new Blob([new Uint8Array(pngBytes(4))]);
    const converted = await rasterToArrayBuffer(blob);
    expect(storedPngIsValid(converted)).toBe(true);

    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('blob', 1, { db, opfs });
    const rasterId = document.pages[document.workspaceOrder[0]!]!.rasterId;
    db.rasters.set(rasterId, new Blob([new Uint8Array(pngBytes(5))]));
    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.encodedPng.get(rasterId)?.byteLength).toBeGreaterThan(7);

    db.rasters.set(rasterId, new Blob([new Uint8Array(notPng())]));
    const restored = await loadEditorBoot(document.projectId, { db, opfs });
    expect(restored?.document.projectId).toBe(document.projectId);
    expect(storedPngIsValid(await db.getRaster(rasterId))).toBe(true);
  });

  test('create then torn live before first idle restores blank created state', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('blank', 2, { db, opfs });
    await tearLiveMissingClip(db, document.projectId);
    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.pasteboardClips).toHaveLength(0);
    expect(Object.keys(boot!.document.pages)).toHaveLength(2);
  });

  test('meta missing with live document does not restore', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('no-meta', 1, { db, opfs });
    await db.deleteMeta(document.projectId);
    await tearLiveMissingClip(db, document.projectId);
    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.pasteboardClips).toHaveLength(1);
  });
});
