/**
 * .clip export job: drives page-by-page generation and streaming ZIP assembly.
 * Environment-agnostic — the Web Worker entry injects browser deps
 * (fetch/sql.js-wasm/OffscreenCanvas); Node tests inject file-system deps.
 *
 * Memory model: only one page is in flight at a time (pull-based ink request),
 * and finished ZIP chunks are folded into Blob parts immediately so the JS
 * heap never holds the whole archive.
 */
import type { SqlJsStatic } from 'sql.js';
import { buildPageClip } from './buildPageClip';
import { readPageTemplateRgba } from './canvasPreview';
import type { ClipExportStartMessage, ClipWorkerResponse } from './clipExportProtocol';
import { parseClip } from './container';
import { createClipZipStream } from './zipStream';

export interface ClipExportJobDeps {
  loadSql(): Promise<SqlJsStatic>;
  loadTemplate(): Promise<Uint8Array>;
  /** Decode a page-ink PNG into CLIP-canvas-sized RGBA (1518x2150). */
  decodeInkPng(png: ArrayBuffer): Promise<Uint8Array | null>;
  post(message: ClipWorkerResponse, transfer?: Transferable[]): void;
}

export class ClipExportJob {
  private readonly inkWaiters = new Map<number, (png: ArrayBuffer | null) => void>();
  private templatePreviewRgba: Uint8Array | null = null;

  constructor(private readonly deps: ClipExportJobDeps) {}

  /** Feed an ink response from the main thread. */
  receiveInk(index: number, png: ArrayBuffer | null): void {
    const waiter = this.inkWaiters.get(index);
    this.inkWaiters.delete(index);
    waiter?.(png);
  }

  private requestInk(index: number): Promise<ArrayBuffer | null> {
    return new Promise((resolve) => {
      this.inkWaiters.set(index, resolve);
      this.deps.post({ type: 'need-ink', index });
    });
  }

  async run(start: ClipExportStartMessage): Promise<void> {
    try {
      const blob = await this.generate(start);
      this.deps.post({ type: 'done', blob });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.post({ type: 'error', message });
    }
  }

  private async generate(start: ClipExportStartMessage): Promise<Blob> {
    const sql = await this.deps.loadSql();
    const template = parseClip(await this.deps.loadTemplate());
    if (!this.templatePreviewRgba) {
      const db = new sql.Database(template.sqliteBytes);
      try {
        this.templatePreviewRgba = readPageTemplateRgba(db, template.extas);
      } finally {
        db.close();
      }
    }
    const total = start.pages.length;
    if (total === 0 || start.entryNames.length !== total) {
      throw new Error(`invalid job: ${total} pages / ${start.entryNames.length} entry names`);
    }

    const blobParts: Blob[] = [];
    let pageChunks: Uint8Array[] = [];
    const foldChunksIntoBlobPart = () => {
      if (pageChunks.length > 0) {
        blobParts.push(new Blob(pageChunks as BlobPart[]));
        pageChunks = [];
      }
    };
    const zip =
      start.mode === 'zip'
        ? createClipZipStream((chunk) => {
            pageChunks.push(chunk);
          })
        : null;

    for (let i = 0; i < total; i++) {
      this.deps.post({ type: 'progress', current: i + 1, total });

      const png = await this.requestInk(i);
      const lineartRgba =
        png && png.byteLength > 0 ? await this.deps.decodeInkPng(png) : null;

      const clipBytes = buildPageClip({
        sql,
        template,
        texts: start.pages[i]!.texts,
        rasterWidth: start.rasterWidth,
        rasterHeight: start.rasterHeight,
        lineartRgba,
        templatePreviewRgba: this.templatePreviewRgba,
      });

      if (zip) {
        zip.addFile(`${start.folderName}/${start.entryNames[i]!}`, clipBytes);
        foldChunksIntoBlobPart();
      } else {
        blobParts.push(new Blob([clipBytes as BlobPart]));
      }
    }

    if (zip) {
      zip.finish();
      foldChunksIntoBlobPart();
    }

    const type = start.mode === 'zip' ? 'application/zip' : 'application/octet-stream';
    return new Blob(blobParts, { type });
  }
}
