import { describe, expect, test } from 'vitest';

import { createEditorDocument, sequentialIds } from '../../domain/document';
import { encodeTransparentPngBuffer } from '../transparentPng';
import { recoverOrphanClips } from '../recoverOrphanClips';
import { MemoryStorageDatabase } from '../testUtils/memoryDb';

function inkyPng(): ArrayBuffer {
  const base = new Uint8Array(encodeTransparentPngBuffer(40, 40));
  const padded = new Uint8Array(base.length + 4000);
  padded.set(base);
  return padded.buffer;
}

describe('recoverOrphanClips', () => {
  test('puts unreferenced clip rasters back on the pasteboard', async () => {
    const db = new MemoryStorageDatabase();
    const doc = createEditorDocument({ projectId: 'p', name: 'n', pageCount: 1, rasterWidth: 8, rasterHeight: 8, ids: sequentialIds('x') });
    const meta = { id: 'p', name: 'n', updatedAt: 'x', pageCount: 1 };
    await db.commitDocumentGeneration({ document: doc, meta, rasters: new Map(), snapshot: 'none' });
    await db.putRaster('p:clip:gone', inkyPng());
    await db.putRaster('p:clip:blank', encodeTransparentPngBuffer(4, 4));
    await db.putRaster('other:clip:x', inkyPng());

    expect(await recoverOrphanClips('p', db)).toEqual(['gone']);
    const after = await db.getDocument('p');
    expect(after?.pasteboardClips.map((c) => c.id)).toEqual(['gone']);
    expect(await recoverOrphanClips('p', db)).toEqual([]);
  });

  test('an explicit id list restores exactly those, even small ones', async () => {
    const db = new MemoryStorageDatabase();
    const doc = createEditorDocument({ projectId: 'p', name: 'n', pageCount: 1, rasterWidth: 8, rasterHeight: 8, ids: sequentialIds('x') });
    await db.commitDocumentGeneration({ document: doc, meta: { id: 'p', name: 'n', updatedAt: 'x', pageCount: 1 }, rasters: new Map(), snapshot: 'none' });
    await db.putRaster('p:clip:a', encodeTransparentPngBuffer(4, 4));
    await db.putRaster('p:clip:b', inkyPng());
    expect(await recoverOrphanClips('p', db, ['a'])).toEqual(['a']);
  });
});
