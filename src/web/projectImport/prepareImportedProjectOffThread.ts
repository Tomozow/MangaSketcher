import {
  prepareImportedProjectFromZip,
  type PreparedImportedProject,
  type ProjectImportProgress,
} from '@/src/storage/prepareImportedProject';
import { ProjectPackError } from '@/src/storage/projectPack';
import type { ProjectImportWorkerRequest, ProjectImportWorkerResponse } from './projectImportProtocol';

const WORKER_START_TIMEOUT_MS = 4000;

function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
      return;
    }
    setTimeout(resolve, 0);
  });
}

async function prepareOnMainThread(
  zip: ArrayBuffer,
  newProjectId: string,
  onProgress?: (progress: ProjectImportProgress) => void,
): Promise<PreparedImportedProject> {
  return prepareImportedProjectFromZip(new Uint8Array(zip), newProjectId, {
    onProgress,
    yieldFn: yieldToPaint,
    unzipAsync: true,
  });
}

function createImportWorker(): Worker {
  return new Worker(new URL('./projectImport.worker.ts', import.meta.url), {
    name: 'project-import',
  });
}

async function prepareOnWorker(
  zip: ArrayBuffer,
  newProjectId: string,
  onProgress?: (progress: ProjectImportProgress) => void,
): Promise<PreparedImportedProject> {
  const worker = createImportWorker();
  const copy = zip.slice(0);
  return new Promise<PreparedImportedProject>((resolve, reject) => {
    let started = false;
    const startTimer = setTimeout(() => {
      if (!started) {
        cleanup();
        reject(new Error('import worker silent'));
      }
    }, WORKER_START_TIMEOUT_MS);

    const onMessage = (event: MessageEvent<ProjectImportWorkerResponse>) => {
      const msg = event.data;
      if (!msg) {
        return;
      }
      started = true;
      clearTimeout(startTimer);
      if (msg.type === 'progress') {
        onProgress?.({ phase: msg.phase, current: msg.current, total: msg.total });
        return;
      }
      if (msg.type === 'done') {
        cleanup();
        resolve({
          document: msg.document,
          rasters: new Map(msg.rasters),
        });
        return;
      }
      if (msg.type === 'error') {
        cleanup();
        reject(new ProjectPackError(msg.message));
      }
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(event.error ?? new Error(event.message || 'import worker crashed'));
    };
    const cleanup = () => {
      clearTimeout(startTimer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const request: ProjectImportWorkerRequest = { type: 'start', zip: copy, newProjectId };
    worker.postMessage(request, [copy]);
  });
}

/**
 * Unzip and normalize rasters off the page thread when a Worker can start.
 * If the worker cannot run (next dev + iOS Safari eval-source-map), fall back
 * to async unzip + per-raster yields on the main thread.
 */
export async function prepareImportedProjectOffThread(
  zip: ArrayBuffer,
  newProjectId: string,
  onProgress?: (progress: ProjectImportProgress) => void,
): Promise<PreparedImportedProject> {
  try {
    return await prepareOnWorker(zip, newProjectId, onProgress);
  } catch (err) {
    if (err instanceof ProjectPackError) {
      throw err;
    }
    return prepareOnMainThread(zip, newProjectId, onProgress);
  }
}
