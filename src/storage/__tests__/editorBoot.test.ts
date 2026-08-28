import { loadEditorBoot, editorHistoryFromBoot } from '../editorBoot';
import { undoEditorHistory } from '../history';
import { createProject, writeProjectPdf } from '../projectStore';
import { MemoryStorageDatabase } from '../testUtils/memoryDb';
import { MemoryOpfsStorage } from '../testUtils/memoryOpfs';
import { pdfOpfsPath } from '../rasterIds';

describe('loadEditorBoot', () => {
  test('returns null when project is missing', async () => {
    const db = new MemoryStorageDatabase();
    const boot = await loadEditorBoot('missing', { db, opfs: new MemoryOpfsStorage() });
    expect(boot).toBeNull();
  });

  test('loads rasters and reports missing OPFS pdf without dropping text JSON', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('boot', 2, { db, opfs });
    const pageId = document.workspaceOrder[0]!;
    document.pages[pageId]!.texts.push({
      id: 't1',
      content: '復元テキスト',
      box: { x: 1, y: 2, width: 3, height: 4 },
      fontSize: 36,
      color: '#1A1A1A',
    });
    document.pdf = {
      pageCount: 1,
      currentPage: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      sourceTextByPage: { 1: [{ str: 'pdf', x: 0, y: 0, width: 1, height: 1, fontSize: 12 }] },
      opfsPath: pdfOpfsPath(document.projectId),
      generation: 1,
    };
    await db.putDocument(document);

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.document.pages[pageId]?.texts[0]?.content).toBe('復元テキスト');
    expect(boot?.encodedPng.size).toBe(2);
    expect(boot?.pdfMissing).toBe(true);
    expect(boot?.pdfFile).toBeNull();
  });

  test('loads OPFS pdf file when present', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('pdf', 1, { db, opfs });
    await writeProjectPdf(document.projectId, Uint8Array.from([37, 80, 68]).buffer, { db, opfs });
    document.pdf = {
      pageCount: 1,
      currentPage: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      sourceTextByPage: {},
      opfsPath: pdfOpfsPath(document.projectId),
      generation: 1,
    };
    await db.putDocument(document);

    const boot = await loadEditorBoot(document.projectId, { db, opfs });
    expect(boot?.pdfMissing).toBe(false);
    expect(boot?.pdfFile).not.toBeNull();
    const bytes = new Uint8Array(await boot!.pdfFile!.arrayBuffer());
    expect(bytes[0]).toBe(37);
  });

  test('reload starts with empty undo stacks (§12 gate 13)', async () => {
    const db = new MemoryStorageDatabase();
    const { document } = await createProject('reload-undo', 2, { db });
    document.inkGeneration = 99;
    await db.putDocument(document);

    const boot = await loadEditorBoot(document.projectId, { db });
    expect(boot).not.toBeNull();

    const history = editorHistoryFromBoot(boot!);
    expect(history.past).toHaveLength(0);
    expect(history.future).toHaveLength(0);
    expect(undoEditorHistory(history, {
      restoreRaster() {},
      captureRaster() {
        return undefined;
      },
      invalidateThumb() {},
    })).toBeNull();
  });
});
