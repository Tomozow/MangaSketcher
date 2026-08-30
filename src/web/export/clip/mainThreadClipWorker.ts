/**
 * In-process stand-in for the .clip export Worker.
 * Used when webpack's eval-source-map worker cannot run (iOS Safari + next dev).
 */
import { decodeInkPngToClipRgba, loadClipTemplate, loadSqlJs } from './clipExportBrowser';
import { ClipExportJob } from './clipExportJob';
import type { ClipWorkerLike, ClipWorkerRequest, ClipWorkerResponse } from './clipExportProtocol';

export function createMainThreadClipWorker(): ClipWorkerLike {
  let job: ClipExportJob | null = null;
  const worker: ClipWorkerLike = {
    onmessage: null,
    onerror: null,
    terminate() {
      job = null;
    },
    postMessage(message: ClipWorkerRequest) {
      if (message.type === 'start') {
        job = new ClipExportJob({
          loadSql: loadSqlJs,
          loadTemplate: loadClipTemplate,
          decodeInkPng: decodeInkPngToClipRgba,
          post: (response: ClipWorkerResponse) => {
            worker.onmessage?.({ data: response });
          },
        });
        void job.run(message);
        return;
      }
      if (message.type === 'ink') {
        job?.receiveInk(message.index, message.png);
      }
    },
  };
  return worker;
}
