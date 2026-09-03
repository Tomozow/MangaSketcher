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

describe('AutosaveManager', () => {
  test('route-leave flush writes rasters before documents without waiting debounce', async () => {
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', new ArrayBuffer(4)]]);
    const order: string[] = [];
    const originalPutRaster = db.putRaster.bind(db);
    const originalPutDocument = db.putDocument.bind(db);
    db.putRaster = async (id, png) => {
      order.push(`raster:${id}`);
      return originalPutRaster(id, png);
    };
    db.putDocument = async (doc) => {
      order.push(`document:${doc.projectId}`);
      return originalPutDocument(doc);
    };

    const manager = new AutosaveManager({
      db,
      getEncodedPng: () => encoded,
    });
    manager.scheduleSave(sampleDoc(), ['p1:page:a'], false);
    await manager.flushRouteLeave();
    expect(order).toEqual(['raster:p1:page:a', 'document:p1']);
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
    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', new ArrayBuffer(9)]]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    manager.flushHidden();
    await Promise.resolve();
    const png = await db.getRaster('p1:page:a');
    expect(png?.byteLength).toBe(9);
    manager.dispose();
  });

  test('flushHidden never calls convertToBlob or encoding pipeline', async () => {
    const db = new MemoryStorageDatabase();
    const convertToBlob = vi.fn(async () => new Blob());
    const buffer = new ArrayBuffer(7);
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

    manager.flushHidden();
    await Promise.resolve();

    expect(convertToBlob).not.toHaveBeenCalled();
    expect(encodingStarted).toBe(false);
    const stored = await db.getRaster('p1:page:a');
    expect(stored?.byteLength).toBe(buffer.byteLength);
    manager.dispose();
  });

  test('flushHidden writes pending document JSON', async () => {
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', new ArrayBuffer(4)]]);
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
    const originalPutDocument = db.putDocument.bind(db);
    db.putDocument = async (doc) => {
      putDocumentCalls += 1;
      concurrentExecutes += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentExecutes);
      if (putDocumentCalls === 1) {
        await firstPutGate;
      }
      try {
        return await originalPutDocument(doc);
      } finally {
        concurrentExecutes -= 1;
      }
    };

    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', new ArrayBuffer(4)]]);
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
    const originalPutDocument = db.putDocument.bind(db);
    db.putDocument = async (doc) => {
      putDocumentCalls += 1;
      if (putDocumentCalls === 1) {
        await firstPutGate;
      }
      return originalPutDocument(doc);
    };

    const encoded = new Map<string, ArrayBuffer>([['p1:page:a', new ArrayBuffer(4)]]);
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

  test('writes only dirty rasters even when the document lists more', async () => {
    const db = new MemoryStorageDatabase();
    const written: string[] = [];
    const originalPutRaster = db.putRaster.bind(db);
    db.putRaster = async (id, png) => {
      written.push(id);
      return originalPutRaster(id, png);
    };
    const encoded = new Map<string, ArrayBuffer>([
      ['p1:page:a', new ArrayBuffer(4)],
      ['p1:clip:c1', new ArrayBuffer(8)],
    ]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    const doc = sampleDoc();
    doc.pasteboardClips = [{ id: 'c1', rasterId: 'p1:clip:c1', x: 0, y: 0, scale: 1, rotation: 0 }];
    manager.scheduleSave(doc, ['p1:page:a'], false);
    await manager.flushRouteLeave();
    expect(written).toEqual(['p1:page:a']);
    expect(await db.getRaster('p1:clip:c1')).toBeUndefined();
    manager.dispose();
  });

  test('merges dirty raster ids across coalesced scheduleSave calls', async () => {
    const db = new MemoryStorageDatabase();
    const written: string[] = [];
    const originalPutRaster = db.putRaster.bind(db);
    db.putRaster = async (id, png) => {
      written.push(id);
      return originalPutRaster(id, png);
    };
    const encoded = new Map<string, ArrayBuffer>([
      ['p1:page:a', new ArrayBuffer(4)],
      ['p1:clip:c1', new ArrayBuffer(8)],
    ]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    manager.scheduleSave(sampleDoc(), ['p1:page:a'], false);
    manager.scheduleSave(sampleDoc(), ['p1:clip:c1'], true);
    await manager.flushRouteLeave();
    expect(written.sort()).toEqual(['p1:clip:c1', 'p1:page:a']);
    manager.dispose();
  });
});
