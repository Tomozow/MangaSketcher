/**
 * Web Worker entry for .clip export. Wires browser deps (fetch, sql.js WASM,
 * OffscreenCanvas PNG decode) into the environment-agnostic ClipExportJob.
 * Bundled by webpack via `new Worker(new URL('./clipExport.worker.ts', import.meta.url))`.
 */
import { decodeInkPngToClipRgba, loadClipTemplate, loadSqlJs } from './clipExportBrowser';
import { ClipExportJob } from './clipExportJob';
import type { ClipWorkerRequest, ClipWorkerResponse } from './clipExportProtocol';

// tsconfig uses lib "dom" (no "webworker"); type the worker scope minimally.
type WorkerScope = {
  postMessage(message: ClipWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};
const scope = self as unknown as WorkerScope;

let job: ClipExportJob | null = null;

scope.onmessage = (event: MessageEvent) => {
  const msg = event.data as ClipWorkerRequest;
  if (msg.type === 'start') {
    job = new ClipExportJob({
      loadSql: loadSqlJs,
      loadTemplate: loadClipTemplate,
      decodeInkPng: decodeInkPngToClipRgba,
      post: (message, transfer) => scope.postMessage(message, transfer ?? []),
    });
    void job.run(msg);
    return;
  }
  if (msg.type === 'ink') {
    job?.receiveInk(msg.index, msg.png);
  }
};
