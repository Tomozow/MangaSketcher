import { describe, expect, test, vi } from 'vitest';
import { createEditorDocument, sequentialIds } from '../../../domain/document';
import type { EditorDocument } from '../../../domain/types';
import type {
  ClipExportStartMessage,
  ClipWorkerRequest,
  ClipWorkerResponse,
} from '../clip/clipExportProtocol';
import { WorkspaceExportAbortedError, WorkspaceExportError } from '../errors';
import type { InkExportSource } from '../exportWorkspace';
import { buildClipExportNames, runClipExport, type ClipWorkerLike } from '../runClipExport';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBuffer(extra = 4): ArrayBuffer {
  const bytes = new Uint8Array(PNG_MAGIC.length + extra);
  bytes.set(PNG_MAGIC);
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}

function makeDoc(pageCount: number): EditorDocument {
  const doc = createEditorDocument({
    projectId: 'p',
    name: '企画',
    pageCount,
    ids: sequentialIds('pg'),
  });
  for (const pageId of doc.workspaceOrder) {
    doc.pages[pageId]!.texts.push({
      id: `${pageId}-t`,
      content: 'あいうえお',
      box: { x: 700, y: 100, width: 300, height: 400 },
      fontSize: 36,
      color: '#1A1A1A',
    });
  }
  return doc;
}

function makeInk(pngs: Map<string, ArrayBuffer | undefined>): InkExportSource {
  return {
    flushPendingEncodes: vi.fn(),
    isEncoding: () => false,
    captureRasterPng: (rasterId: string) => pngs.get(rasterId),
  };
}

/** Scripted worker following the real protocol; resolves with a fixed blob. */
class FakeClipWorker implements ClipWorkerLike {
  onmessage: ((event: { data: ClipWorkerResponse }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  received: ClipWorkerRequest[] = [];
  inks: (ArrayBuffer | null)[] = [];
  private start: ClipExportStartMessage | null = null;

  constructor(private readonly resultBytes = new Uint8Array([1, 2, 3])) {}

  postMessage(message: ClipWorkerRequest): void {
    this.received.push(message);
    if (message.type === 'start') {
      this.start = message;
      queueMicrotask(() => this.step());
      return;
    }
    if (message.type === 'ink') {
      this.inks.push(message.png);
      queueMicrotask(() => this.step());
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(msg: ClipWorkerResponse): void {
    if (!this.terminated) {
      this.onmessage?.({ data: msg });
    }
  }

  private step(): void {
    if (!this.start || this.terminated) {
      return;
    }
    const total = this.start.pages.length;
    const index = this.inks.length;
    if (index < total) {
      this.emit({ type: 'progress', current: index + 1, total });
      this.emit({ type: 'need-ink', index });
      return;
    }
    const type = this.start.mode === 'zip' ? 'application/zip' : 'application/octet-stream';
    this.emit({ type: 'done', blob: new Blob([this.resultBytes], { type }) });
  }
}

describe('buildClipExportNames', () => {
  test('zip names', () => {
    expect(buildClipExportNames('企画', '20260830-1200', 'zip', 1)).toEqual({
      fileName: '企画_20260830-1200_clip.zip',
      folderName: '企画_20260830-1200_clip',
    });
  });

  test('single page names use the workspace page number', () => {
    expect(buildClipExportNames('企画', '20260830-1200', 'single', 3).fileName).toBe(
      '企画_20260830-1200_p003.clip',
    );
  });
});

describe('runClipExport', () => {
  test('zip mode: feeds ink per page, reports progress, returns the zip file', async () => {
    const doc = makeDoc(2);
    const [r1, r2] = doc.workspaceOrder.map((id) => doc.pages[id]!.rasterId);
    const pngs = new Map<string, ArrayBuffer | undefined>([
      [r1!, pngBuffer()],
      [r2!, new ArrayBuffer(0)],
    ]);
    const ink = makeInk(pngs);
    const worker = new FakeClipWorker();
    const progress: { current: number; total: number }[] = [];
    const order: string[] = [];

    const file = await runClipExport({
      doc,
      inkEngine: ink,
      mode: 'zip',
      onBeforeExport: async () => {
        order.push('checkpoint');
      },
      onProgress: (p) => progress.push(p),
      now: new Date(2026, 7, 30, 12, 0, 0),
      createWorker: () => worker,
    });

    expect(order).toEqual(['checkpoint']);
    expect(ink.flushPendingEncodes).toHaveBeenCalled();
    expect(file.name).toBe('企画_20260830-1200_clip.zip');
    expect(file.type).toBe('application/zip');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(progress).toEqual([
      { current: 1, total: 2 },
      { current: 2, total: 2 },
    ]);
    // Page with real ink → transferred PNG; empty raster → null.
    expect(worker.inks.map((p) => (p ? 'png' : null))).toEqual(['png', null]);
    expect(worker.terminated).toBe(true);

    const start = worker.received[0]!;
    if (start.type !== 'start') {
      throw new Error('first message must be start');
    }
    expect(start.entryNames).toEqual(['001.clip', '002.clip']);
    expect(start.pages).toHaveLength(2);
    expect(start.pages[0]!.texts[0]!.content).toBe('あいうえお');
  });

  test('single mode exports the selected page with its workspace number', async () => {
    const doc = makeDoc(3);
    doc.selectedPageId = doc.workspaceOrder[2]!;
    const pngs = new Map<string, ArrayBuffer | undefined>(
      doc.workspaceOrder.map((id) => [doc.pages[id]!.rasterId, new ArrayBuffer(0)]),
    );
    const worker = new FakeClipWorker();

    const file = await runClipExport({
      doc,
      inkEngine: makeInk(pngs),
      mode: 'single',
      now: new Date(2026, 7, 30, 12, 0, 0),
      createWorker: () => worker,
    });

    expect(file.name).toBe('企画_20260830-1200_p003.clip');
    expect(file.type).toBe('application/octet-stream');
    const start = worker.received[0]!;
    if (start.type !== 'start') {
      throw new Error('first message must be start');
    }
    expect(start.pages).toHaveLength(1);
    expect(start.folderName).toBe('');
  });

  test('single mode without a selected workspace page fails', async () => {
    const doc = makeDoc(1);
    doc.selectedPageId = null;
    await expect(
      runClipExport({
        doc,
        inkEngine: makeInk(new Map()),
        mode: 'single',
        createWorker: () => new FakeClipWorker(),
      }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
  });

  test('missing captured raster rejects and terminates the worker', async () => {
    const doc = makeDoc(1);
    const worker = new FakeClipWorker();
    await expect(
      runClipExport({
        doc,
        inkEngine: makeInk(new Map()),
        mode: 'zip',
        createWorker: () => worker,
      }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
    expect(worker.terminated).toBe(true);
  });

  test('abort after start rejects with WorkspaceExportAbortedError and terminates the worker', async () => {
    const doc = makeDoc(2);
    const worker = new FakeClipWorker();
    const controller = new AbortController();
    // Worker that never answers; abort once the start message has been sent.
    worker.postMessage = (message: ClipWorkerRequest) => {
      worker.received.push(message);
      if (message.type === 'start') {
        queueMicrotask(() => controller.abort());
      }
    };

    const pending = runClipExport({
      doc,
      inkEngine: makeInk(
        new Map(doc.workspaceOrder.map((id) => [doc.pages[id]!.rasterId, new ArrayBuffer(0)])),
      ),
      mode: 'zip',
      signal: controller.signal,
      createWorker: () => worker,
    });

    await expect(pending).rejects.toBeInstanceOf(WorkspaceExportAbortedError);
    expect(worker.terminated).toBe(true);
  });

  test('worker onerror becomes WorkspaceExportError when a test worker is injected', async () => {
    const doc = makeDoc(1);
    const pngs = new Map<string, ArrayBuffer | undefined>(
      doc.workspaceOrder.map((id) => [doc.pages[id]!.rasterId, new ArrayBuffer(0)]),
    );
    const worker = {
      onmessage: null as ClipWorkerLike['onmessage'],
      onerror: null as ClipWorkerLike['onerror'],
      terminated: false,
      postMessage() {
        queueMicrotask(() => worker.onerror?.(new Event('error')));
      },
      terminate() {
        worker.terminated = true;
      },
    };

    await expect(
      runClipExport({
        doc,
        inkEngine: makeInk(pngs),
        mode: 'zip',
        createWorker: () => worker,
      }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
    expect(worker.terminated).toBe(true);
  });
});
