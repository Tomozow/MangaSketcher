import { AutosaveManager } from '../autosave';
import { MemoryStorageDatabase } from '../testUtils/memoryDb';
import type { EditorDocument } from '../types';

function sampleDoc(): EditorDocument {
  return {
    projectId: 'p1',
    name: 'test',
    rasterWidth: 16,
    rasterHeight: 20,
    pages: {
      a: { id: 'a', texts: [], rasterId: 'p1:page:a' },
    },
    workspaceOrder: ['a'],
    stock: [],
    trash: [],
    trashClips: [],
    trashTexts: [],
    pasteboardClips: [],
    pasteboardTexts: [],
    selectedPageId: 'a',
    selectedClipId: null,
    selectedTextId: null,
    tool: 'pen',
    tools: {
      penColor: '#1A1A1A',
      penSize: 12,
      penOpacity: 1,
      eraserSize: 28,
      eraserOpacity: 1,
      textColor: '#1A1A1A',
      textFontSize: 36,
      pressureEnabled: true,
    },
    pdf: null,
    workspaceZoom: 1,
    workspacePanX: 0,
    workspacePanY: 0,
    stockZoom: 1,
    stockPanX: 0,
    stockPanY: 0,
    workspacePdfSplit: 0.58,
    paletteStockSplit: 0.46,
    pdfDrawerWidth: 0.32,
    pdfDrawerHeight: 1,
    stockDrawerWidth: 0.92,
    stockDrawerHeight: 0.26,
    pdfViewerVisible: true,
    sidebarCompact: false,
    stockLayout: 'free',
    stockPane: 'stock',
    pagesPerColumn: 0,
    pairGap: 4,
    showPairDivider: false,
    columnGap: 0,
    inkGeneration: 0,
  };
}

function png(extra: number): ArrayBuffer {
  const bytes = new Uint8Array(8 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes.buffer;
}

describe('AutosaveManager', () => {
  test('route-leave flush writes the raster and the document in one commit without waiting debounce', async () => {
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', png(4)]]);
    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => encoded,
    });
    manager.scheduleSave(sampleDoc(), ['p1:page:a'], false);
    await manager.flushRouteLeave();
    expect(db.commits).toEqual([['p1:page:a']]);
    expect((await db.liveRaster('p1:page:a'))?.byteLength).toBe(12);
    expect(manager.getStatus().unsaved).toBe(false);
    manager.dispose();
  });

  test('tracks encoding state for unsaved dot while PNG encode is pending', () => {
    const encoded = new Map<string, ArrayBuffer>();
    const manager = new AutosaveManager({
      db: new MemoryStorageDatabase(),
      getEncodedPng: () => encoded,
    });
    manager.notifyEncodingStarted('p1:page:a');
    expect(manager.getStatus()).toEqual({ unsaved: true, encodingCount: 1 });
    encoded.set('p1:page:a', new ArrayBuffer(2));
    manager.notifyEncodingComplete('p1:page:a', encoded.get('p1:page:a')!);
    expect(manager.getStatus()).toEqual({ unsaved: true, encodingCount: 0 });
    manager.dispose();
  });

  test('markUnsaved shows unsaved before the idle write', () => {
    const manager = new AutosaveManager({
      db: new MemoryStorageDatabase(),
      getEncodedPng: () => new Map(),
    });
    expect(manager.getStatus().unsaved).toBe(false);
    manager.markUnsaved();
    expect(manager.getStatus()).toEqual({ unsaved: true, encodingCount: 0 });
    manager.dispose();
  });

  test('flushHidden puts existing encoded PNG without debounce', async () => {
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', png(9)]]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    manager.scheduleSave(sampleDoc(), ['p1:page:a'], false);
    manager.flushHidden();
    await Promise.resolve();
    expect((await db.liveRaster('p1:page:a'))?.byteLength).toBe(17);
    manager.dispose();
  });

  test('flushHidden never calls convertToBlob or encoding pipeline', async () => {
    const db = new MemoryStorageDatabase();
    const convertToBlob = vi.fn(async () => new Blob());
    const buffer = png(7);
    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', buffer]]);
    let encodingStarted = false;

    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => encoded,
    });
    const originalNotify = manager.notifyEncodingStarted.bind(manager);
    manager.notifyEncodingStarted = (rasterId: string) => {
      encodingStarted = true;
      originalNotify(rasterId);
    };

    manager.scheduleSave(sampleDoc(), ['p1:page:a'], false);
    manager.flushHidden();
    await Promise.resolve();

    expect(convertToBlob).not.toHaveBeenCalled();
    expect(encodingStarted).toBe(false);
    const stored = await db.liveRaster('p1:page:a');
    expect(stored?.byteLength).toBe(buffer.byteLength);
    manager.dispose();
  });

  test('flushHidden writes pending document JSON', async () => {
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', png(4)]]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    manager.scheduleSave(
      { ...sampleDoc(), pasteboardClips: [{ id: 'c1', rasterId: 'p1:clip:c1', x: 1, y: 2, scale: 1, rotation: 0 }] },
      [],
      false,
    );
    manager.flushHidden();
    await Promise.resolve();
    const loaded = await db.getDocument('p1');
    expect(loaded?.pasteboardClips).toHaveLength(1);
    expect(loaded?.pasteboardClips[0]?.id).toBe('c1');
    expect(await db.getSnapshotDocument('p1')).toBeUndefined();
    manager.dispose();
  });

  test('flushRouteLeave waits for runningJob before starting another executeJob', async () => {
    vi.useFakeTimers();
    const db = new MemoryStorageDatabase();
    let concurrentExecutes = 0;
    let maxConcurrent = 0;
    let releaseFirstPut!: () => void;
    const firstPutGate = new Promise<void>((resolve) => {
      releaseFirstPut = resolve;
    });
    let putDocumentCalls = 0;
    const originalCommit = db.commitDocumentGeneration.bind(db);
    db.commitDocumentGeneration = async (input) => {
      putDocumentCalls += 1;
      concurrentExecutes += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentExecutes);
      if (putDocumentCalls === 1) {
        await firstPutGate;
      }
      try {
        return await originalCommit(input);
      } finally {
        concurrentExecutes -= 1;
      }
    };

    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', png(4)]]);
    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => encoded,
      getDelays: () => ({ documentMs: 50, viewOnlyMs: 50 }),
    });
    try {
      manager.scheduleSave({ ...sampleDoc(), name: 'version-1' }, ['p1:page:a']);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();

      expect(putDocumentCalls).toBe(1);
      expect(maxConcurrent).toBe(1);

      manager.scheduleSave({ ...sampleDoc(), name: 'version-2' }, ['p1:page:a']);
      const flushPromise = manager.flushRouteLeave();
      await Promise.resolve();
      expect(maxConcurrent).toBe(1);

      releaseFirstPut();
      await flushPromise;

      expect(maxConcurrent).toBe(1);
      const loaded = await db.getDocument('p1');
      expect(loaded?.name).toBe('version-2');
      expect(manager.getStatus().unsaved).toBe(false);
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  test('flushRouteLeave coalesces newer scheduleSave that arrives during wait', async () => {
    vi.useFakeTimers();
    const db = new MemoryStorageDatabase();
    let releaseFirstPut!: () => void;
    const firstPutGate = new Promise<void>((resolve) => {
      releaseFirstPut = resolve;
    });
    let putDocumentCalls = 0;
    const originalCommit = db.commitDocumentGeneration.bind(db);
    db.commitDocumentGeneration = async (input) => {
      putDocumentCalls += 1;
      if (putDocumentCalls === 1) {
        await firstPutGate;
      }
      return originalCommit(input);
    };

    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', png(4)]]);
    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => encoded,
      getDelays: () => ({ documentMs: 50, viewOnlyMs: 50 }),
    });
    try {
      manager.scheduleSave({ ...sampleDoc(), name: 'version-1' }, ['p1:page:a']);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();

      const flushPromise = manager.flushRouteLeave();
      await Promise.resolve();

      manager.scheduleSave({ ...sampleDoc(), name: 'version-3' }, ['p1:page:a']);
      releaseFirstPut();
      await flushPromise;

      const loaded = await db.getDocument('p1');
      expect(loaded?.name).toBe('version-3');
      expect(manager.getStatus().unsaved).toBe(false);
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  test('updatePendingDocument だけでは保存を開始しない', async () => {
    vi.useFakeTimers();
    const db = new MemoryStorageDatabase();
    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => new Map(),
      getDelays: () => ({ documentMs: 50, viewOnlyMs: 50 }),
    });
    try {
      const next = sampleDoc();
      next.tools = { ...next.tools, penSize: 40 };
      manager.updatePendingDocument(next);
      expect(manager.getStatus().unsaved).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(await db.getDocument('p1')).toBeUndefined();
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  test('既に予約された保存があるときだけ、ツールサイズをその文書に載せる', async () => {
    vi.useFakeTimers();
    const db = new MemoryStorageDatabase();
    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => new Map(),
      getDelays: () => ({ documentMs: 200, viewOnlyMs: 200 }),
    });
    try {
      manager.scheduleSave(sampleDoc(), [], false);
      const next = sampleDoc();
      next.tools = { ...next.tools, penSize: 40, eraserSize: 64 };
      manager.updatePendingDocument(next);
      await vi.advanceTimersByTimeAsync(199);
      expect(await db.getDocument('p1')).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      const loaded = await db.getDocument('p1');
      expect(loaded?.tools.penSize).toBe(40);
      expect(loaded?.tools.eraserSize).toBe(64);
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  test('document delay を差し替えると、その時間まで IndexedDB へ書かない', async () => {
    vi.useFakeTimers();
    const db = new MemoryStorageDatabase();
    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => new Map(),
      getDelays: () => ({ documentMs: 5000, viewOnlyMs: 6000 }),
    });
    try {
      manager.scheduleSave(sampleDoc(), [], false);
      await vi.advanceTimersByTimeAsync(4999);
      expect(await db.getDocument('p1')).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(await db.getDocument('p1')).toBeDefined();
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  test('the first save writes only rasters that differ from what boot loaded', async () => {
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([
      ['p1:page:a', png(4)],
      ['p1:clip:c1', png(8)],
    ]);
    // Boot loaded the clip with these bytes; the page has been redrawn since.
    const storedPng = new Map([
      ['p1:page:a', png(1)],
      ['p1:clip:c1', png(8)],
    ]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded, storedPng });
    const doc = sampleDoc();
    doc.pasteboardClips = [{ id: 'c1', rasterId: 'p1:clip:c1', x: 0, y: 0, scale: 1, rotation: 0 }];
    manager.scheduleSave(doc, ['p1:page:a', 'p1:clip:c1'], false);
    await manager.flushRouteLeave();
    expect(db.commits).toEqual([['p1:page:a']]);
    manager.dispose();
  });

  test('merges dirty raster ids across coalesced scheduleSave calls', async () => {
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([
      ['p1:page:a', png(4)],
      ['p1:clip:c1', png(8)],
    ]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    const doc = sampleDoc();
    doc.pasteboardClips = [{ id: 'c1', rasterId: 'p1:clip:c1', x: 0, y: 0, scale: 1, rotation: 0 }];
    manager.scheduleSave(doc, ['p1:page:a'], false);
    manager.scheduleSave(doc, ['p1:clip:c1'], true);
    await manager.flushRouteLeave();
    expect(db.commits.map((ids) => [...ids].sort())).toEqual([['p1:clip:c1', 'p1:page:a']]);
    manager.dispose();
  });

  test('a raster that returns to the document is written again even though it is not dirty', async () => {
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([
      ['p1:page:a', png(4)],
      ['p1:clip:c1', png(8)],
    ]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    const withClip = sampleDoc();
    withClip.pasteboardClips = [{ id: 'c1', rasterId: 'p1:clip:c1', x: 0, y: 0, scale: 1, rotation: 0 }];
    manager.scheduleSave(withClip, ['p1:clip:c1'], false);
    await manager.flushRouteLeave();
    // Clip deleted: two saves later its stored revision is gone.
    manager.scheduleSave(sampleDoc(), [], false);
    await manager.flushRouteLeave();
    manager.scheduleSave({ ...sampleDoc(), name: 'again' }, [], false);
    await manager.flushRouteLeave();
    expect((await db.listRasterIds()).filter((key) => key.startsWith('p1:clip:c1'))).toEqual([]);
    // Undo brings the clip back without marking it dirty.
    manager.scheduleSave(withClip, [], false);
    await manager.flushRouteLeave();
    expect((await db.liveRaster('p1:clip:c1'))?.byteLength).toBe(16);
    manager.dispose();
  });
});
