import { describe, expect, test } from 'vitest';

import { AutosaveManager } from '../autosave';
import { createEditorDocument, sequentialIds } from '../../domain/document';

const doc = () =>
  createEditorDocument({ projectId: 'p', name: 'n', pageCount: 2, rasterWidth: 8, rasterHeight: 8, ids: sequentialIds('x') });
const [A, B] = Object.values(doc().pages).map((page) => page.rasterId) as [string, string];

function manager(commit: () => Promise<unknown>, commitTimeoutMs = 20) {
  return new AutosaveManager({
    db: { commitDocumentGeneration: commit } as never,
    getEncodedPng: () => new Map(),
    getDelays: () => ({ documentMs: 0, viewOnlyMs: 0 }),
    commitTimeoutMs,
  });
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('autosave failure handling', () => {
  test('a hung commit times out, counts as a failure, and does not block later saves', async () => {
    let calls = 0;
    const mgr = manager(() => (++calls === 1 ? new Promise(() => {}) : Promise.resolve({ snapshotUpdated: true })));
    mgr.scheduleSave(doc(), []);
    await tick(60);
    expect(mgr.getStatus().saveFailures).toBe(1);
    expect(await mgr.retry()).toBe(true);
    expect(calls).toBe(2);
    expect(mgr.getStatus()).toEqual({ unsaved: false, encodingCount: 0 });
  });

  test('consecutive failures accumulate and retry reports failure', async () => {
    const mgr = manager(async () => {
      throw new Error('quota');
    });
    mgr.scheduleSave(doc(), []);
    await tick(20);
    expect(await mgr.retry()).toBe(false);
    expect(mgr.getStatus().saveFailures).toBe(2);
    expect(mgr.getStatus().unsaved).toBe(true);
  });

  test('failed job keeps its dirty rasters for the retry', async () => {
    const seen: string[][] = [];
    let fail = true;
    const mgr = new AutosaveManager({
      db: {
        commitDocumentGeneration: async (input: { rasters?: Map<string, ArrayBuffer> }) => {
          seen.push([...(input.rasters?.keys() ?? [])]);
          if (fail) throw new Error('x');
          return { snapshotUpdated: true };
        },
      } as never,
      getEncodedPng: () => new Map([[A, new Uint8Array([1]).buffer]]),
      getDelays: () => ({ documentMs: 0, viewOnlyMs: 0 }),
    });
    mgr.scheduleSave(doc(), [A]);
    await tick(20);
    fail = false;
    expect(await mgr.retry()).toBe(true);
    expect(seen).toEqual([[A], [A]]);
  });

  test('encode failure and abort are reported through status', () => {
    const mgr = manager(async () => ({}));
    mgr.notifyEncodingStarted('r');
    mgr.notifyEncodingFailed('r');
    expect(mgr.getStatus()).toMatchObject({ encodingCount: 0, saveFailures: 1 });
    mgr.notifyEncodingStarted('r');
    mgr.notifyEncodingAborted('r');
    expect(mgr.getStatus().saveFailures).toBeUndefined();
    expect(mgr.getStatus().encodingCount).toBe(0);
  });
});

describe('torn generation protection', () => {
  test('commit waits for in-flight encodes, then writes everything at once', async () => {
    const commits: string[][] = [];
    const png = new Uint8Array([1, 2, 3]).buffer;
    const encoded = new Map<string, ArrayBuffer>();
    const mgr = new AutosaveManager({
      db: {
        commitDocumentGeneration: async (input: { rasters?: Map<string, ArrayBuffer> }) => {
          commits.push([...(input.rasters?.keys() ?? [])].sort());
          return { snapshotUpdated: true };
        },
      } as never,
      getEncodedPng: () => encoded,
      getDelays: () => ({ documentMs: 0, viewOnlyMs: 0 }),
    });
    mgr.notifyEncodingStarted(A);
    mgr.notifyEncodingStarted(B);
    mgr.scheduleSave(doc(), [A, B]);
    await tick(120);
    expect(commits).toEqual([]);
    encoded.set(A, png);
    encoded.set(B, new Uint8Array([4]).buffer);
    mgr.notifyEncodingComplete(A, png);
    mgr.notifyEncodingComplete(B, png);
    await tick(150);
    expect(commits).toEqual([[A, B].sort()]);
  });

  test('flushHidden writes nothing while an encode is in flight', async () => {
    let atomic = 0;
    const mgr = new AutosaveManager({
      db: {
        putLiveAtomic: async () => {
          atomic += 1;
        },
        putRaster: async () => {
          atomic += 1;
        },
        putDocument: async () => {
          atomic += 1;
        },
        putMeta: async () => {
          atomic += 1;
        },
      } as never,
      getEncodedPng: () => new Map([[A, new Uint8Array([1]).buffer]]),
      getDelays: () => ({ documentMs: 1000, viewOnlyMs: 1000 }),
    });
    mgr.scheduleSave(doc(), [A]);
    mgr.notifyEncodingStarted(A);
    mgr.flushHidden();
    await tick(10);
    expect(atomic).toBe(0);
    mgr.notifyEncodingComplete(A, new ArrayBuffer(1));
    mgr.flushHidden();
    await tick(10);
    expect(atomic).toBe(1);
    mgr.dispose();
  });
});

describe('commit gate', () => {
  function gated(encoded: Map<string, ArrayBuffer>, commits: string[][]) {
    return new AutosaveManager({
      db: {
        commitDocumentGeneration: async (input: { rasters?: Map<string, ArrayBuffer> }) => {
          commits.push([...(input.rasters?.keys() ?? [])].sort());
          return { snapshotUpdated: true };
        },
      } as never,
      getEncodedPng: () => encoded,
      getDelays: () => ({ documentMs: 0, viewOnlyMs: 0 }),
      encodeSettleMaxMs: 30,
    });
  }

  test('an encode that never settles blocks the commit and keeps the job', async () => {
    const commits: string[][] = [];
    const encoded = new Map<string, ArrayBuffer>();
    const mgr = gated(encoded, commits);
    mgr.notifyEncodingStarted(A);
    mgr.scheduleSave(doc(), [A]);
    await tick(120);
    expect(commits).toEqual([]);
    expect(mgr.getStatus()).toMatchObject({ unsaved: true, saveFailures: 1 });
    encoded.set(A, new Uint8Array([1]).buffer);
    mgr.notifyEncodingComplete(A, encoded.get(A)!);
    expect(await mgr.retry()).toBe(true);
    expect(commits).toEqual([[A]]);
    expect(mgr.getStatus()).toEqual({ unsaved: false, encodingCount: 0 });
  });

  test('a failed encode blocks the commit until it is retried', async () => {
    const commits: string[][] = [];
    const encoded = new Map<string, ArrayBuffer>([[A, new Uint8Array([1]).buffer]]);
    const mgr = gated(encoded, commits);
    mgr.notifyEncodingStarted(A);
    mgr.notifyEncodingFailed(A);
    mgr.scheduleSave(doc(), [A]);
    await tick(30);
    expect(commits).toEqual([]);
    mgr.notifyEncodingStarted(A);
    mgr.notifyEncodingComplete(A, encoded.get(A)!);
    expect(await mgr.retry()).toBe(true);
    expect(commits).toEqual([[A]]);
  });

  test('a raster whose PNG is unchanged since the last commit is not written again', async () => {
    const commits: string[][] = [];
    const d = doc();
    const [rasterId] = Object.values(d.pages).map((page) => page.rasterId);
    const encoded = new Map<string, ArrayBuffer>([[rasterId, new Uint8Array([1]).buffer]]);
    const mgr = gated(encoded, commits);
    mgr.scheduleSave(d, [rasterId]);
    await mgr.flushRouteLeave();
    mgr.scheduleSave(d, [rasterId]);
    await mgr.flushRouteLeave();
    encoded.set(rasterId, new Uint8Array([2]).buffer);
    mgr.scheduleSave(d, [rasterId]);
    await mgr.flushRouteLeave();
    expect(commits).toEqual([[rasterId], [], [rasterId]]);
  });
});
