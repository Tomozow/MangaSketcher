/**
 * Main-thread orchestrator for ".clip export": snapshots the document, waits
 * for ink encodes, then drives the export Web Worker (pull-based ink feed,
 * progress, cancellation). See clip/clipExportProtocol.ts for the message flow.
 */
import { cloneEditorDocument } from '../../domain/document';
import type { EditorDocument, PageId } from '../../domain/types';
import { isPngBuffer } from '../ink/fakeCanvas';
import type {
  ClipExportMode,
  ClipExportStartMessage,
  ClipWorkerRequest,
  ClipWorkerResponse,
} from './clip/clipExportProtocol';
import { MAX_WORKSPACE_EXPORT_PAGES, padPageIndex } from './constants';
import { throwIfAborted, WorkspaceExportAbortedError, WorkspaceExportError } from './errors';
import type { ExportProgress, InkExportSource } from './exportWorkspace';
import { formatExportTimestamp, sanitizeExportStem } from './sanitizeExportName';
import { waitForInkEncodes, type EncodeWaitClock } from './waitForInkEncode';

export type { ClipExportMode } from './clip/clipExportProtocol';

/** Structural Worker interface so tests can inject a fake. */
export type ClipWorkerLike = {
  postMessage(message: ClipWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: ClipWorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export function buildClipExportNames(
  stem: string,
  timestamp: string,
  mode: ClipExportMode,
  pageNumber: number,
): { fileName: string; folderName: string } {
  if (mode === 'single') {
    return {
      fileName: `${stem}_${timestamp}_p${padPageIndex(pageNumber)}.clip`,
      folderName: '',
    };
  }
  const folderName = `${stem}_${timestamp}_clip`;
  return { fileName: `${folderName}.zip`, folderName };
}

function createDefaultClipWorker(): ClipWorkerLike {
  return new Worker(
    new URL('./clip/clipExport.worker.ts', import.meta.url),
  ) as unknown as ClipWorkerLike;
}

export type RunClipExportInput = {
  doc: EditorDocument;
  inkEngine: InkExportSource;
  mode: ClipExportMode;
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

  let pageIds: PageId[];
  let singlePageNumber = 1;
  if (input.mode === 'single') {
    const selected = snapshot.selectedPageId;
    const orderIndex = selected ? order.indexOf(selected) : -1;
    if (!selected || orderIndex < 0) {
      throw new WorkspaceExportError();
    }
    pageIds = [selected];
    singlePageNumber = orderIndex + 1;
  } else {
    if (order.length === 0 || order.length > MAX_WORKSPACE_EXPORT_PAGES) {
      throw new WorkspaceExportError();
    }
    pageIds = [...order];
  }
  for (const pageId of pageIds) {
    if (!snapshot.pages[pageId]) {
      throw new WorkspaceExportError();
    }
  }

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
  const names = buildClipExportNames(stem, timestamp, input.mode, singlePageNumber);
  const entryNames =
    input.mode === 'zip'
      ? pageIds.map((_, i) => `${padPageIndex(i + 1)}.clip`)
      : [names.fileName];

  const start: ClipExportStartMessage = {
    type: 'start',
    mode: input.mode,
    rasterWidth: snapshot.rasterWidth,
    rasterHeight: snapshot.rasterHeight,
    folderName: names.folderName,
    entryNames,
    pages: pageIds.map((pageId) => ({
      texts: snapshot.pages[pageId]!.texts.map((t) => ({
        content: t.content,
        box: { ...t.box },
        fontSize: t.fontSize,
      })),
    })),
  };

  const worker = (input.createWorker ?? createDefaultClipWorker)();
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      if (input.signal) {
        if (input.signal.aborted) {
          reject(new WorkspaceExportAbortedError());
          return;
        }
        input.signal.addEventListener(
          'abort',
          () => reject(new WorkspaceExportAbortedError()),
          { once: true },
        );
      }
      worker.onerror = () => reject(new WorkspaceExportError());
      worker.onmessage = (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'need-ink': {
            const pageId = pageIds[msg.index];
            const page = pageId ? snapshot.pages[pageId] : undefined;
            if (!page) {
              reject(new WorkspaceExportError());
              return;
            }
            const captured = input.inkEngine.captureRasterPng(page.rasterId);
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
            if (!input.signal?.aborted) {
              input.onProgress?.({ current: msg.current, total: msg.total });
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

    const type = input.mode === 'zip' ? 'application/zip' : 'application/octet-stream';
    return new File([blob], names.fileName, { type, lastModified: Date.now() });
  } finally {
    worker.terminate();
  }
}
