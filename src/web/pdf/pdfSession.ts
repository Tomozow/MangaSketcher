'use client';

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { PDF_WORKER_SRC } from './constants';
import { clearPdfPageBitmaps } from './pdfPageCache';

type PdfJsModule = typeof import('pdfjs-dist');
type PdfDocumentProxy = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;

type SessionEntry = {
  opfsPath: string;
  generation: number;
  proxy: PdfDocumentProxy;
};

const sessions = new Map<string, SessionEntry>();

function sessionKey(opfsPath: string, generation: number): string {
  return `${opfsPath}#g=${generation}`;
}

function ensureWorker(): void {
  if (typeof window === 'undefined') {
    return;
  }
  GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
}

/** §7.9 / §10.2 — keep PDFDocumentProxy for the session; do not re-getDocument on page turns. */
export async function getOrLoadPdfProxy(
  opfsPath: string,
  generation: number,
  data: ArrayBuffer | Uint8Array,
): Promise<PdfDocumentProxy> {
  const key = sessionKey(opfsPath, generation);
  const existing = sessions.get(key);
  if (existing) {
    return existing.proxy;
  }
  ensureWorker();
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const loadingTask = getDocument({ data: bytes });
  const proxy = await loadingTask.promise;
  sessions.set(key, { opfsPath, generation, proxy });
  return proxy;
}

export function dropPdfSession(opfsPath: string, generation: number): void {
  sessions.delete(sessionKey(opfsPath, generation));
  clearPdfPageBitmaps();
}

export function clearPdfSessions(): void {
  sessions.clear();
  clearPdfPageBitmaps();
}

export type { PdfDocumentProxy };
