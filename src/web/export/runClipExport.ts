/**
 * Main-thread orchestrator for ".clip export": snapshots the document, waits
 * for ink encodes, then drives the export Web Worker (pull-based ink feed,
 * progress, cancellation). See clip/clipExportProtocol.ts for the message flow.
 *
 * next dev compiles the worker with eval-source-map, which iOS Safari rejects.
 * Development therefore runs ClipExportJob on the page thread. Production still
 * uses a Worker, with a one-shot main-thread fallback if the worker crashes.
 */
import { cloneEditorDocument } from '../../domain/document';
import type { EditorDocument, PageId } from '../../domain/types';
import { isPngBuffer } from '../ink/fakeCanvas';
import type {
  ClipExportMode,
  ClipExportStartMessage,
  ClipWorkerLike,
  ClipWorkerResponse,
} from './clip/clipExportProtocol';
import { MAX_WORKSPACE_EXPORT_PAGES, padPageIndex } from './constants';
import { throwIfAborted, WorkspaceExportAbortedError, WorkspaceExportError } from './errors';
import type { ExportProgress, InkExportSource } from './exportWorkspace';
import type { PageScopeMode } from './exportFormat';
import { buildPageExportFileName, folderNameFromExportFileName } from './buildPageExportFileName';
import { formatExportTimestamp, sanitizeExportStem } from './sanitizeExportName';
import { waitForInkEncodes, type EncodeWaitClock } from './waitForInkEncode';

export type { ClipExportMode, ClipWorkerLike } from './clip/clipExportProtocol';

class ClipWorkerCrashedError extends Error {
  constructor() {
    super('clip worker crashed');
    this.name = 'ClipWorkerCrashedError';
  }
}

export function buildClipExportNames(
  stem: string,
  timestamp: string,
  mode: ClipExportMode,
  pageNumber: number,
  pick: PageScopeMode = mode === 'single' ? 'current' : 'all',
  count = mode === 'single' ? 1 : 2,
  firstNumber = pageNumber,
  lastNumber = pageNumber,
): { fileName: string; folderName: string } {
  const fileName = buildPageExportFileName({
    format: 'clip',
    stem,
    timestamp,
    pick: mode === 'single' ? 'current' : pick,
    count: mode === 'single' ? 1 : count,
    firstNumber,
    lastNumber,
  });
  if (mode === 'single') {
    return { fileName, folderName: '' };
  }
  return { fileName, folderName: folderNameFromExportFileName(fileName) };
}

async function createDefaultClipWorker(): Promise<ClipWorkerLike> {
  if (process.env.NODE_ENV !== 'production') {
    const { createMainThreadClipWorker } = await import('./clip/mainThreadClipWorker');
    return createMainThreadClipWorker();
  }
  try {
    return new Worker(new URL('./clip/clipExport.worker.ts', import.meta.url), {
      name: 'clip-export',
    }) as unknown as ClipWorkerLike;
  } catch {
    const { createMainThreadClipWorker } = await import('./clip/mainThreadClipWorker');
    return createMainThreadClipWorker();
  }
}

export type RunClipExportInput = {
  doc: EditorDocument;
  inkEngine: InkExportSource;
  mode: ClipExportMode;
  pageIds?: PageId[];
  pick?: PageScopeMode;
  onBeforeExport?: () => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  now?: Date;
  encodeWait?: EncodeWaitClock;
  createWorker?: () => ClipWorkerLike;
};

export async function runClipExport(input: RunClipExportInput): Promise<File> {
  if (input.onBeforeExport) {
    await input.onBeforeExport();
  }
  throwIfAborted(input.signal);

  const snapshot = cloneEditorDocument(input.doc);
  const order = snapshot.workspaceOrder;
  const pick = input.pick ?? (input.mode === 'single' ? 'current' : 'all');

  let pageIds: PageId[];
  if (input.pageIds) {
    pageIds = input.pageIds;
    if (pageIds.length === 0 || pageIds.length > MAX_WORKSPACE_EXPORT_PAGES) {
      throw new WorkspaceExportError();
    }
  } else if (input.mode === 'single') {
    const selected = snapshot.selectedPageId;
    const orderIndex = selected ? order.indexOf(selected) : -1;
    if (!selected || orderIndex < 0) {
      throw new WorkspaceExportError();
    }
    pageIds = [selected];
  } else {
    if (order.length === 0 || order.length > MAX_WORKSPACE_EXPORT_PAGES) {
      throw new WorkspaceExportError();
    }
    pageIds = [...order];
  }
  for (const pageId of pageIds) {
    if (!snapshot.pages[pageId] || !order.includes(pageId)) {
      throw new WorkspaceExportError();
    }
  }

  const mode: ClipExportMode = pageIds.length === 1 ? 'single' : 'zip';
  const firstNumber = order.indexOf(pageIds[0]!) + 1;
  const lastNumber = order.indexOf(pageIds[pageIds.length - 1]!) + 1;

  const rasterIds = pageIds.map((pageId) => snapshot.pages[pageId]!.rasterId);
  input.inkEngine.flushPendingEncodes();
  await waitForInkEncodes(
    (rasterId) => input.inkEngine.isEncoding(rasterId),
    rasterIds,
    input.encodeWait,
  );
  throwIfAborted(input.signal);

  const timestamp = formatExportTimestamp(input.now ?? new Date());
  const stem = sanitizeExportStem(snapshot.name);
  const names = buildClipExportNames(
    stem,
    timestamp,
    mode,
    firstNumber,
    pick,
    pageIds.length,
    firstNumber,
    lastNumber,
  );
  const entryNames =
    mode === 'zip'
      ? pageIds.map((_, i) => `${padPageIndex(i + 1)}.clip`)
      : [names.fileName];

  const start: ClipExportStartMessage = {
    type: 'start',
    mode,
    rasterWidth: snapshot.rasterWidth,
    rasterHeight: snapshot.rasterHeight,
    folderName: names.folderName,
    entryNames,
    pages: pageIds.map((pageId) => ({
      texts: snapshot.pages[pageId]!.texts.map((t) => ({
        content: t.content,
        box: { ...t.box },
        fontSize: t.fontSize,
        writingMode: t.writingMode,
      })),
    })),
  };

  let worker = input.createWorker ? input.createWorker() : await createDefaultClipWorker();
  const allowMainThreadFallback = !input.createWorker;
  try {
    const blob = await driveClipWorker(worker, start, {
      pageIds,
      snapshot,
      inkEngine: input.inkEngine,
      signal: input.signal,
      onProgress: input.onProgress,
    }).catch(async (err) => {
      if (err instanceof ClipWorkerCrashedError && allowMainThreadFallback) {
        worker.terminate();
        const { createMainThreadClipWorker } = await import('./clip/mainThreadClipWorker');
        worker = createMainThreadClipWorker();
        return driveClipWorker(worker, start, {
          pageIds,
          snapshot,
          inkEngine: input.inkEngine,
          signal: input.signal,
          onProgress: input.onProgress,
        });
      }
      if (err instanceof ClipWorkerCrashedError) {
        throw new WorkspaceExportError();
      }
      throw err;
    });

    const type = mode === 'zip' ? 'application/zip' : 'application/octet-stream';
    return new File([blob], names.fileName, { type, lastModified: Date.now() });
  } finally {
    worker.terminate();
  }
}

function driveClipWorker(
  worker: ClipWorkerLike,
  start: ClipExportStartMessage,
  ctx: {
    pageIds: PageId[];
    snapshot: EditorDocument;
    inkEngine: InkExportSource;
    signal?: AbortSignal;
    onProgress?: (progress: ExportProgress) => void;
  },
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (ctx.signal) {
      if (ctx.signal.aborted) {
        reject(new WorkspaceExportAbortedError());
        return;
      }
      ctx.signal.addEventListener(
        'abort',
        () => reject(new WorkspaceExportAbortedError()),
        { once: true },
      );
    }
    worker.onerror = () => reject(new ClipWorkerCrashedError());
    worker.onmessage = (event) => {
      const msg: ClipWorkerResponse = event.data;
      switch (msg.type) {
        case 'need-ink': {
          const pageId = ctx.pageIds[msg.index];
          const page = pageId ? ctx.snapshot.pages[pageId] : undefined;
          if (!page) {
            reject(new WorkspaceExportError());
            return;
          }
          const captured = ctx.inkEngine.captureRasterPng(page.rasterId);
          if (captured === undefined) {
            reject(new WorkspaceExportError());
            return;
          }
          if (captured.byteLength > 0 && !isPngBuffer(captured)) {
            reject(new WorkspaceExportError());
            return;
          }
          const png = captured.byteLength > 0 ? captured : null;
          worker.postMessage({ type: 'ink', index: msg.index, png }, png ? [png] : []);
          break;
        }
        case 'progress':
          if (!ctx.signal?.aborted) {
            ctx.onProgress?.({ current: msg.current, total: msg.total });
          }
          break;
        case 'done':
          resolve(msg.blob);
          break;
        case 'error':
          reject(new WorkspaceExportError(msg.message));
          break;
      }
    };
    worker.postMessage(start);
  });
}
