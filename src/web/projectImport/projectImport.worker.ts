/**
 * Web Worker for project-pack unzip + raster normalize.
 * Bundled by webpack via `new Worker(new URL('./projectImport.worker.ts', import.meta.url))`.
 */
import { prepareImportedProjectFromZip } from '@/src/storage/prepareImportedProject';
import { ProjectPackError } from '@/src/storage/projectPack';
import type { ProjectImportWorkerRequest, ProjectImportWorkerResponse } from './projectImportProtocol';

type WorkerScope = {
  postMessage(message: ProjectImportWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};
const scope = self as unknown as WorkerScope;

scope.onmessage = (event: MessageEvent) => {
  const msg = event.data as ProjectImportWorkerRequest;
  if (msg.type !== 'start') {
    return;
  }
  void (async () => {
    try {
      const zipBytes = new Uint8Array(msg.zip);
      const prepared = await prepareImportedProjectFromZip(zipBytes, msg.newProjectId, {
        onProgress: (progress) => {
          if (progress.phase === 'unzip' || progress.phase === 'normalize') {
            scope.postMessage({ type: 'progress', ...progress });
          }
        },
      });
      const rasters = [...prepared.rasters.entries()];
      const transfer = rasters.map(([, png]) => png);
      scope.postMessage({ type: 'done', document: prepared.document, rasters }, transfer);
    } catch (err) {
      const message =
        err instanceof ProjectPackError || err instanceof Error
          ? err.message
          : 'インポートに失敗しました。';
      scope.postMessage({ type: 'error', message });
    }
  })();
};
