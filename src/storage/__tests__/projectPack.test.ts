import { unzipSync, strFromU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { createProject, exportProjectPack, importProjectPack, loadDocument } from '../projectStore';
import { collectRasterIds, clipRasterId, pageRasterId } from '../rasterIds';
import {
  buildProjectPackFileName,
  buildProjectPackZip,
  DOCUMENT_JSON,
  MANIFEST_JSON,
  parseProjectPackZip,
  PROJECT_PACK_FORMAT_VERSION,
  PROJECT_PACK_MAGIC,
  ProjectPackError,
  rasterZipPathForDocumentMember,
  rasterZipPathFromClipId,
  rasterZipPathFromPageId,
  rewriteImportedDocument,
} from '../projectPack';
import { buildWorkspaceZip } from '../../web/export/buildWorkspaceZip';
import {
  encodeInkGrayAlphaPng,
  encodeInkRgbaPng,
  pngColorType,
  tryDecodePngToRgba,
} from '../compactInkPng';
import { MemoryStorageDatabase } from '../testUtils/memoryDb';
import { MemoryOpfsStorage } from '../testUtils/memoryOpfs';

const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function pngBuffer(extra = 0): ArrayBuffer {
  const bytes = new Uint8Array(PNG_HEADER.length + extra);
  bytes.set(PNG_HEADER);
  return bytes.buffer;
}

const noopCheckpoint = { requestExportCheckpoint: async () => {} };

describe('project pack naming', () => {
  test('uses mangasketcher timestamp suffix', () => {
    const date = new Date(2026, 7, 30, 12, 5);
    expect(buildProjectPackFileName('企画', date)).toBe('企画_mangasketcher_20260830-1205.zip');
  });
});

describe('buildProjectPackZip / parseProjectPackZip', () => {
  test('round-trips trash pages and pasteboard clips', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('roundtrip', 2, { db, opfs });
    const activePageId = document.workspaceOrder[0]!;
    const trashPageId = document.workspaceOrder[1]!;
    document.trash = [trashPageId];
    document.workspaceOrder = [activePageId];
    document.pasteboardClips.push({
      id: 'clip-1',
      rasterId: clipRasterId(document.projectId, 'clip-1'),
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    await db.putDocument(document);
    await db.putRaster(clipRasterId(document.projectId, 'clip-1'), pngBuffer(4));

    const rasters = new Map<string, ArrayBuffer>();
    for (const rasterId of collectRasterIds(document)) {
      const png = await db.getRaster(rasterId);
      if (png) {
        rasters.set(rasterId, png);
      }
    }

    const parsed = parseProjectPackZip(buildProjectPackZip({ document, rasters }));
    expect(parsed.manifest.rasterMembers.sort()).toEqual(
      [
        rasterZipPathFromPageId(activePageId),
        rasterZipPathFromPageId(trashPageId),
        rasterZipPathFromClipId('clip-1'),
      ].sort(),
    );
    expect(parsed.document.trash).toEqual([trashPageId]);
    expect(parsed.document.pasteboardClips).toHaveLength(1);
    expect(parsed.document.pdf).toBeNull();
  });

  test('strips pdf from exported document', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('pdf', 1, { db, opfs });
    document.pdf = {
      opfsPath: `pdfs/${document.projectId}.pdf`,
      pageCount: 1,
      currentPage: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      sourceTextByPage: {},
      generation: 1,
      fileName: 'ref.pdf',
    };
    await db.putDocument(document);

    const rasters = new Map<string, ArrayBuffer>();
    for (const rasterId of collectRasterIds(document)) {
      const png = await db.getRaster(rasterId);
      if (png) {
        rasters.set(rasterId, png);
      }
    }

    const parsed = parseProjectPackZip(buildProjectPackZip({ document, rasters }));
    expect(parsed.document.pdf).toBeNull();
  });

  test('rejects workspace png zip', () => {
    const workspaceZip = buildWorkspaceZip({
      folderName: 'demo_20260829-1522',
      pages: [{ index: 1, png: PNG_HEADER }],
      text: 'hello',
    });
    expect(() => parseProjectPackZip(workspaceZip)).toThrow(ProjectPackError);
  });

  test('rejects zip-slip paths', async () => {
    const { document } = await createProject('slip', 1, {
      db: new MemoryStorageDatabase(),
      opfs: new MemoryOpfsStorage(),
    });
    const rasters = new Map<string, ArrayBuffer>();
    for (const rasterId of collectRasterIds(document)) {
      rasters.set(rasterId, pngBuffer());
    }
    const zip = buildProjectPackZip({ document, rasters });
    const entries = unzipSync(zip);
    entries['../evil.png'] = PNG_HEADER;
    expect(() => parseProjectPackZip(zipSync(entries))).toThrow(ProjectPackError);
  });

  test('rejects extra raster members not listed in manifest', async () => {
    const { document } = await createProject('extra', 1, {
      db: new MemoryStorageDatabase(),
      opfs: new MemoryOpfsStorage(),
    });
    const rasters = new Map<string, ArrayBuffer>();
    for (const rasterId of collectRasterIds(document)) {
      rasters.set(rasterId, pngBuffer());
    }
    const zip = buildProjectPackZip({ document, rasters });
    const entries = unzipSync(zip);
    entries['rasters/page__ghost.png'] = PNG_HEADER;
    const manifest = JSON.parse(strFromU8(entries[MANIFEST_JSON]!));
    manifest.rasterMembers.push('rasters/page__ghost.png');
    entries[MANIFEST_JSON] = new TextEncoder().encode(JSON.stringify(manifest));
    expect(() => parseProjectPackZip(zipSync(entries))).toThrow(ProjectPackError);
  });
});

describe('rewriteImportedDocument', () => {
  test('rebuilds raster ids from page and clip ids', async () => {
    const { document } = await createProject('rewrite', 1, {
      db: new MemoryStorageDatabase(),
      opfs: new MemoryOpfsStorage(),
    });
    const pageId = document.workspaceOrder[0]!;
    document.pages[pageId]!.rasterId = 'wrong:key:here';
    document.pasteboardClips.push({
      id: 'clip-1',
      rasterId: 'also:wrong:clip',
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });

    const rewritten = rewriteImportedDocument(document, 'new-project-id');
    expect(rewritten.projectId).toBe('new-project-id');
    expect(rewritten.pages[pageId]!.rasterId).toBe(pageRasterId('new-project-id', pageId));
    expect(rewritten.pasteboardClips[0]!.rasterId).toBe(clipRasterId('new-project-id', 'clip-1'));
    expect(rewritten.pdf).toBeNull();
  });
});

describe('exportProjectPack / importProjectPack', () => {
  test('import mints a new project id and keeps pack name', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document, meta } = await createProject('imported', 2, { db, opfs });
    document.pasteboardClips.push({
      id: 'clip-1',
      rasterId: clipRasterId(document.projectId, 'clip-1'),
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    await db.putDocument(document);
    await db.putRaster(clipRasterId(document.projectId, 'clip-1'), pngBuffer(2));

    const exported = await exportProjectPack(meta.id, { db, opfs, ...noopCheckpoint });
    expect(exported.name).toContain('imported_mangasketcher_');
    expect(exported.type).toBe('application/zip');

    const imported = await importProjectPack(exported, { db, opfs, now: () => '2026-03-01T00:00:00.000Z' });
    expect(imported.id).not.toBe(meta.id);
    expect(imported.name).toBe('imported');
    expect(imported.pageCount).toBe(2);
    expect(imported.updatedAt).toBe('2026-03-01T00:00:00.000Z');

    const loaded = await loadDocument(imported.id, { db, opfs });
    expect(loaded?.projectId).toBe(imported.id);
    for (const rasterId of collectRasterIds(loaded!)) {
      expect(rasterId.startsWith(`${imported.id}:`)).toBe(true);
      expect(await db.getRaster(rasterId)).toBeDefined();
    }
  });

  test('failed atomic import leaves no partial project', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { meta } = await createProject('fail', 1, { db, opfs });
    const exported = await exportProjectPack(meta.id, { db, opfs, ...noopCheckpoint });
    db.failImportProjectAtomic = true;

    await expect(importProjectPack(exported, { db, opfs })).rejects.toThrow(ProjectPackError);
    expect([...db.meta.values()]).toHaveLength(1);
    expect(await db.getDocument(meta.id)).toBeDefined();
  });

  test('export fills missing rasters with a transparent png', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document, meta } = await createProject('missing-raster', 1, { db, opfs });
    const rasterId = collectRasterIds(document)[0]!;
    await db.deleteRaster(rasterId);

    const file = await exportProjectPack(meta.id, { db, opfs, ...noopCheckpoint });
    expect(file.size).toBeGreaterThan(0);
    expect(file.size).toBeLessThan(200 * 1024);
    const parsed = parseProjectPackZip(new Uint8Array(await file.arrayBuffer()));
    expect(parsed.rasters.size).toBe(1);
    const [png] = [...parsed.rasters.values()];
    expect(png!.byteLength).toBeLessThan(8 * 1024);
  });

  test('re-encodes an older rgba empty raster and still parses', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('legacy-empty', 1, { db, opfs });
    const rasterId = collectRasterIds(document)[0]!;
    const width = 16;
    const height = 12;
    const rgbaEmpty = encodeInkRgbaPng(new Uint8Array(width * height * 4), width, height);
    const zip = buildProjectPackZip({
      document,
      rasters: new Map([[rasterId, rgbaEmpty]]),
    });
    const parsed = parseProjectPackZip(zip);
    const packed = [...parsed.rasters.values()][0]!;
    expect(pngColorType(packed)).toBe(6);
    const decoded = tryDecodePngToRgba(packed);
    expect(decoded?.width).toBe(width);
    expect(decoded?.height).toBe(height);
    expect(decoded?.rgba.every((value) => value === 0)).toBe(true);
    expect(pngColorType(packed)).toBe(6);
  });

  test('import rewrites gray+alpha rasters to rgba', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document, meta } = await createProject('type4-import', 1, { db, opfs });
    const rasterId = collectRasterIds(document)[0]!;
    const width = 6;
    const height = 4;
    const rgba = new Uint8Array(width * height * 4);
    rgba[0] = 0;
    rgba[1] = 0;
    rgba[2] = 0;
    rgba[3] = 200;
    const grayAlpha = encodeInkGrayAlphaPng(rgba, width, height);
    expect(pngColorType(grayAlpha)).toBe(4);
    await db.putRaster(rasterId, grayAlpha);

    const zip = zipSync({
      [MANIFEST_JSON]: new TextEncoder().encode(
        JSON.stringify({
          magic: PROJECT_PACK_MAGIC,
          formatVersion: PROJECT_PACK_FORMAT_VERSION,
          exportedProjectId: document.projectId,
          rasterMembers: [rasterZipPathFromPageId(document.workspaceOrder[0]!)],
        }),
      ),
      [DOCUMENT_JSON]: new TextEncoder().encode(JSON.stringify({ ...document, pdf: null })),
      [rasterZipPathFromPageId(document.workspaceOrder[0]!)]: new Uint8Array(grayAlpha),
    });
    const imported = await importProjectPack(new File([zip], 'type4.zip', { type: 'application/zip' }), {
      db,
      opfs,
      ...noopCheckpoint,
      now: () => '2026-03-02T00:00:00.000Z',
    });
    const loaded = await loadDocument(imported.id, { db, opfs });
    const importedRasterId = collectRasterIds(loaded!)[0]!;
    const stored = await db.getRaster(importedRasterId);
    expect(pngColorType(stored!)).toBe(6);
    expect(imported.id).not.toBe(meta.id);
  });
});

describe('pack layout', () => {
  test('contains manifest, document, and raster entries only', async () => {
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const { document } = await createProject('layout', 1, { db, opfs });
    const rasters = new Map<string, ArrayBuffer>();
    for (const rasterId of collectRasterIds(document)) {
      rasters.set(rasterId, (await db.getRaster(rasterId))!);
    }
    const zip = buildProjectPackZip({ document, rasters });
    const entries = unzipSync(zip);
    const pageId = document.workspaceOrder[0]!;
    expect(Object.keys(entries).sort()).toEqual([
      DOCUMENT_JSON,
      MANIFEST_JSON,
      rasterZipPathFromPageId(pageId),
    ]);
    const manifest = JSON.parse(strFromU8(entries[MANIFEST_JSON]!));
    expect(manifest).toEqual({
      magic: PROJECT_PACK_MAGIC,
      formatVersion: PROJECT_PACK_FORMAT_VERSION,
      exportedProjectId: document.projectId,
      rasterMembers: [rasterZipPathFromPageId(pageId)],
    });
  });
});
