import { describe, expect, test, vi } from 'vitest';
import { createEditorDocument } from '../../storage/editorDocument';
import { createEditorHistory } from '../../storage/history';
import { AutosaveManager } from '../../storage/autosave';
import { MemoryStorageDatabase } from '../../storage/testUtils/memoryDb';
import {
  consumePendingInkHistory,
  runEditorCheckpoint,
  type PendingInkHistoryItem,
} from '../editorCheckpoint';

function sampleHistory() {
  const doc = createEditorDocument({ projectId: 'p1', name: 'n', pageCount: 1 });
  const pageId = doc.workspaceOrder[0]!;
  const rasterId = doc.pages[pageId]!.rasterId;
  return { doc, history: createEditorHistory(doc), rasterId, pageId };
}

describe('consumePendingInkHistory', () => {
  test('commits pen overlay bake into history and bumps inkGeneration', () => {
    const { history, rasterId } = sampleHistory();
    const undo = new ArrayBuffer(4);
    const pending: PendingInkHistoryItem[] = [{ rasterId, canvas: undo }];
    const next = consumePendingInkHistory(history, pending);
    expect(next.present.inkGeneration).toBe(history.present.inkGeneration + 1);
    expect(next.past).toHaveLength(1);
  });
});

describe('runEditorCheckpoint', () => {
  test('consumes pending ink, schedules save, and flushes to IDB', async () => {
    const { doc, history, rasterId } = sampleHistory();
    const db = new MemoryStorageDatabase();
    const encoded = new Map<string, ArrayBuffer>([[rasterId, new ArrayBuffer(8)]]);
    const manager = new AutosaveManager({ db, getEncodedPng: () => encoded });
    let historyState = history;
    const calls: string[] = [];

    const ink = {
      drainPendingBakeWork: vi.fn(() => [{ rasterId, canvas: new ArrayBuffer(4) }]),
      flushPendingEncodes: vi.fn(() => {
        calls.push('flushPendingEncodes');
      }),
      isEncoding: vi.fn(() => false),
      encodedPng: encoded,
    };

    await runEditorCheckpoint({
      getHistory: () => historyState,
      setHistory: (next) => {
        historyState = next;
      },
      pendingInkHistory: [],
      clearPendingInkHistory: () => {},
      ink,
      mergeEncodedPng: () => {},
      scheduleSave: (present, dirtyRasterIds) => {
        calls.push('scheduleSave');
        manager.scheduleSave(present, dirtyRasterIds, false);
      },
      flushRouteLeave: async () => {
        calls.push('flushRouteLeave');
        await manager.flushRouteLeave();
      },
      collectRasterIds: (present) => Object.values(present.pages).map((page) => page.rasterId),
    });

    expect(historyState.present.inkGeneration).toBe(doc.inkGeneration + 1);
    expect(calls).toEqual(['flushPendingEncodes', 'scheduleSave', 'flushRouteLeave']);
    const stored = await db.getDocument(doc.projectId);
    expect(stored?.inkGeneration).toBe(doc.inkGeneration + 1);
    const png = await db.getRaster(rasterId);
    expect(png?.byteLength).toBe(8);
    manager.dispose();
  });

  test('waits for in-flight encode before flushRouteLeave', async () => {
    const { history, rasterId } = sampleHistory();
    let encoding = true;
    const calls: string[] = [];

    const ink = {
      drainPendingBakeWork: vi.fn(() => []),
      flushPendingEncodes: vi.fn(() => {
        calls.push('flushPendingEncodes');
        encoding = false;
      }),
      isEncoding: vi.fn(() => encoding),
      encodedPng: new Map<string, ArrayBuffer>([[rasterId, new ArrayBuffer(4)]]),
    };

    await runEditorCheckpoint({
      getHistory: () => history,
      setHistory: () => {},
      pendingInkHistory: [],
      clearPendingInkHistory: () => {},
      ink,
      mergeEncodedPng: () => {},
      scheduleSave: () => {
        calls.push('scheduleSave');
      },
      flushRouteLeave: async () => {
        calls.push('flushRouteLeave');
      },
      collectRasterIds: (present) => Object.values(present.pages).map((page) => page.rasterId),
      encodeWait: { pollMs: 0, timeoutMs: 100, sleep: async () => {}, now: () => 0 },
    });

    expect(ink.flushPendingEncodes).toHaveBeenCalled();
    expect(calls).toEqual(['flushPendingEncodes', 'scheduleSave', 'flushRouteLeave']);
    expect(calls.indexOf('flushPendingEncodes')).toBeLessThan(calls.indexOf('flushRouteLeave'));
    expect(encoding).toBe(false);
  });
});
