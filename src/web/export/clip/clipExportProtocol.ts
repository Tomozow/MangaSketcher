/**
 * Message protocol between the main thread (runClipExport) and the
 * .clip export Web Worker (clipExport.worker.ts).
 *
 *   main → worker : start ─┐
 *   worker → main : need-ink(index)  ← per page, pull-based (memory peak = 1 page)
 *   main → worker : ink(index, png)
 *   worker → main : progress(current/total)
 *   worker → main : done(blob) | error(message)
 */
import type { ClipPageTextInput } from './buildPageClip';

export type ClipExportMode = 'zip' | 'single';

export interface ClipExportPageInput {
  texts: ClipPageTextInput[];
}

export interface ClipExportStartMessage {
  type: 'start';
  mode: ClipExportMode;
  rasterWidth: number;
  rasterHeight: number;
  /** ZIP folder prefix; ignored for mode 'single'. */
  folderName: string;
  /** File name per page inside the ZIP (single mode: exactly one entry). */
  entryNames: string[];
  pages: ClipExportPageInput[];
}

export interface ClipInkMessage {
  type: 'ink';
  index: number;
  /** Encoded ink PNG for the page raster; null when the page has no ink. */
  png: ArrayBuffer | null;
}

export type ClipWorkerRequest = ClipExportStartMessage | ClipInkMessage;

export type ClipWorkerResponse =
  | { type: 'need-ink'; index: number }
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string };

/** Structural Worker interface so tests can inject a fake. */
export type ClipWorkerLike = {
  postMessage(message: ClipWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: ClipWorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};
