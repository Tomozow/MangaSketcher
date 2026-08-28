import {
  createProject,
  deleteProject,
  listProjects,
  loadDocument,
  renameProject,
  runStartupGc,
} from '../projectStore';
import { collectRasterIds } from '../rasterIds';
import { DB_NAME, DB_VERSION } from '../types';
import { MemoryStorageDatabase } from '../testUtils/memoryDb';
import { MemoryOpfsStorage } from '../testUtils/memoryOpfs';

describe('projectStore CRUD', () => {
  test('creates project with meta, documents, and transparent rasters', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { meta, document } = await createProject('ネーム', 3, { db, opfs });
    expect(meta.pageCount).toBe(3);
    expect(meta.name).toBe('ネーム');
    expect(Object.keys(document.pages)).toHaveLength(3);
    for (const rasterId of collectRasterIds(document)) {
      expect(await db.getRaster(rasterId)).toBeDefined();
    }
    const listed = await listProjects({ db, opfs });
    expect(listed.some((item) => item.id === meta.id)).toBe(true);
  });

  test('reload without PDF keeps page count and text', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('persist', 2, { db, opfs });
    const pageId = document.workspaceOrder[0]!;
    document.pages[pageId]!.texts.push({
      id: 'text-1',
      content: '保存テキスト',
      box: { x: 10, y: 20, width: 96, height: 425 },
      fontSize: 36,
      color: '#1A1A1A',
    });
    await db.putDocument(document);

    const reloaded = await loadDocument(document.projectId, { db, opfs });
    expect(reloaded).not.toBeNull();
    expect(Object.keys(reloaded!.pages)).toHaveLength(2);
    expect(reloaded!.pages[pageId]?.texts[0]?.content).toBe('保存テキスト');
    expect(reloaded!.pdf).toBeNull();
  });

  test('rename updates meta and document', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('old', 1, { db, opfs, now: () => '2026-01-01T00:00:00.000Z' });
    const meta = await renameProject(document.projectId, 'new', {
      db,
      opfs,
      now: () => '2026-02-01T00:00:00.000Z',
    });
    expect(meta?.name).toBe('new');
    expect((await loadDocument(document.projectId, { db, opfs }))?.name).toBe('new');
  });
});

describe('projectStore delete order §7.5', () => {
  test('successful delete removes OPFS pdf and all IDB rasters/meta/documents', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document, meta } = await createProject('gone', 2, { db, opfs });
    await opfs.writePdf(document.projectId, Uint8Array.from([1, 2, 3]).buffer);
    await deleteProject(document.projectId, { db, opfs });

    expect(opfs.files.has(document.projectId)).toBe(false);
    expect(await db.getMeta(meta.id)).toBeUndefined();
    expect(await db.getDocument(document.projectId)).toBeUndefined();
    for (const rasterId of collectRasterIds(document)) {
      expect(await db.getRaster(rasterId)).toBeUndefined();
    }
  });

  test('failed IDB delete leaves meta for retry while OPFS may already be gone', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document, meta } = await createProject('retry', 1, { db, opfs });
    await opfs.writePdf(document.projectId, Uint8Array.from([9]).buffer);
    db.failDeleteProjectRecords = true;

    await expect(deleteProject(document.projectId, { db, opfs })).rejects.toThrow();
    expect(opfs.files.has(document.projectId)).toBe(false);
    expect(await db.getMeta(meta.id)).toBeDefined();
    expect(await db.getDocument(document.projectId)).toBeDefined();
    expect((await db.listRasterIds()).length).toBeGreaterThan(0);
  });
});

describe('IndexedDB schema contract', () => {
  test('uses mangasketcher version 1 store names', () => {
    expect(DB_NAME).toBe('mangasketcher');
    expect(DB_VERSION).toBe(1);
  });
});

describe('startup GC', () => {
  test('removes orphan OPFS pdfs and rasters not referenced by meta', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('live', 1, { db, opfs });
    await opfs.writePdf('ghost', Uint8Array.from([7]).buffer);
    await db.putRaster('ghost:page:x', Uint8Array.from([8]).buffer);

    await runStartupGc({ db, opfs });
    expect(opfs.files.has('ghost')).toBe(false);
    expect(await db.getRaster('ghost:page:x')).toBeUndefined();
    expect(await db.getMeta(document.projectId)).toBeDefined();
  });
});
