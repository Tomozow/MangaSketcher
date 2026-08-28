import { describe, expect, test } from 'vitest';
import { CompositePdfStorage, IdbPdfStorage, isOpfsAvailable } from '../opfs';
import { pdfBlobRasterId } from '../rasterIds';
import { MemoryStorageDatabase } from '../testUtils/memoryDb';
import { MemoryOpfsStorage } from '../testUtils/memoryOpfs';

describe('IdbPdfStorage', () => {
  test('round-trips PDF bytes without OPFS', async () => {
    const db = new MemoryStorageDatabase();
    const storage = new IdbPdfStorage(() => db);
    const bytes = Uint8Array.from([37, 80, 68, 70]);
    await storage.writePdf('proj-1', bytes.buffer);
    expect(await db.getRaster(pdfBlobRasterId('proj-1'))).toBeDefined();
    const file = await storage.readPdf('proj-1');
    expect(file).not.toBeNull();
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(bytes);
    expect(await storage.listPdfProjectIds()).toEqual(['proj-1']);
    await storage.deletePdf('proj-1');
    expect(await storage.readPdf('proj-1')).toBeNull();
  });
});

describe('CompositePdfStorage', () => {
  test('writes to IDB when OPFS is unavailable', async () => {
    expect(isOpfsAvailable()).toBe(false);
    const db = new MemoryStorageDatabase();
    const opfs = new MemoryOpfsStorage();
    const storage = new CompositePdfStorage(opfs, new IdbPdfStorage(() => db));
    const bytes = Uint8Array.from([1, 2, 3]);
    await storage.writePdf('p', bytes.buffer);
    expect(opfs.files.has('p')).toBe(false);
    const file = await storage.readPdf('p');
    expect(file).not.toBeNull();
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(bytes);
  });
});
