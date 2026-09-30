import { describe, expect, test } from 'vitest';

import { AutosaveManager } from '../autosave';
import { createEditorDocument, sequentialIds } from '../../domain/document';

const doc = () =>
  createEditorDocument({ projectId: 'p', name: 'n', pageCount: 1, rasterWidth: 8, rasterHeight: 8, ids: sequentialIds('x') });

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
      getEncodedPng: () => new Map([['r1', new Uint8Array([1]).buffer]]),
      getDelays: () => ({ documentMs: 0, viewOnlyMs: 0 }),
    });
    mgr.scheduleSave(doc(), ['r1']);
    await tick(20);
    fail = false;
    expect(await mgr.retry()).toBe(true);
    expect(seen).toEqual([['r1'], ['r1']]);
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
