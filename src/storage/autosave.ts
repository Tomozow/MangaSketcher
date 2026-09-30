import {
  DOCUMENT_SAVE_DEBOUNCE_MS,
  VIEW_ONLY_SAVE_DEBOUNCE_MS,
  type EditorDocument,
  type ProjectMeta,
} from './types';
import { cloneEditorDocument } from './editorDocument';
import type { StorageDatabase } from './idb';
import { getDefaultStorageDatabase } from './idb';
import { requestPersistentStorage } from './persistentStorage';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

export type AutosaveStatus = {
  unsaved: boolean;
  encodingCount: number;
  /** Consecutive failed / timed-out writes. Omitted while healthy. */
  saveFailures?: number;
};

/** A commit that has not settled by then is treated as hung and failed. */
export const COMMIT_TIMEOUT_MS = 30_000;

export class AutosaveCommitTimeoutError extends Error {
  constructor() {
    super('autosave commit timed out');
    this.name = 'AutosaveCommitTimeoutError';
  }
}

export type AutosaveDelays = {
  documentMs: number;
  viewOnlyMs: number;
};

export type AutosaveManagerOptions = {
  db?: StorageDatabase;
  getEncodedPng: () => ReadonlyMap<string, ArrayBuffer>;
  onStatusChange?: (status: AutosaveStatus) => void;
  getDelays?: () => AutosaveDelays;
  commitTimeoutMs?: number;
};

type PendingJob = {
  saveGen: number;
  doc: EditorDocument;
  dirtyRasterIds: Set<string>;
  viewOnly: boolean;
};

function sameStatus(a: AutosaveStatus, b: AutosaveStatus): boolean {
  return (
    a.unsaved === b.unsaved &&
    a.encodingCount === b.encodingCount &&
    (a.saveFailures ?? 0) === (b.saveFailures ?? 0)
  );
}

export class AutosaveManager {
  private readonly db: StorageDatabase;
  private readonly getEncodedPng: () => ReadonlyMap<string, ArrayBuffer>;
  private readonly onStatusChange?: (status: AutosaveStatus) => void;
  private readonly getDelays: () => AutosaveDelays;

  private saveGen = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingJob: PendingJob | null = null;
  private runningJob: PendingJob | null = null;
  private queuedAfterRun: PendingJob | null = null;
  private serialTail: Promise<void> = Promise.resolve();
  private encoding = new Set<string>();
  private unsaved = false;
  private disposed = false;
  private failures = 0;
  private readonly failedEncodes = new Set<string>();
  private readonly commitTimeoutMs: number;

  constructor(options: AutosaveManagerOptions) {
    this.db = options.db ?? getDefaultStorageDatabase();
    this.getEncodedPng = options.getEncodedPng;
    this.onStatusChange = options.onStatusChange;
    this.commitTimeoutMs = options.commitTimeoutMs ?? COMMIT_TIMEOUT_MS;
    this.getDelays =
      options.getDelays ??
      (() => ({
        documentMs: DOCUMENT_SAVE_DEBOUNCE_MS,
        viewOnlyMs: VIEW_ONLY_SAVE_DEBOUNCE_MS,
      }));
  }

  getStatus(): AutosaveStatus {
    const status: AutosaveStatus = { unsaved: this.unsaved, encodingCount: this.encoding.size };
    const failures = this.failures + this.failedEncodes.size;
    if (failures > 0) {
      status.saveFailures = failures;
    }
    return status;
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.getStatus());
  }

  private setUnsaved(value: boolean): void {
    const prev = this.getStatus();
    this.unsaved = value;
    const next = this.getStatus();
    if (!sameStatus(prev, next)) {
      this.emitStatus();
    }
  }

  private setEncodingCount(): void {
    this.emitStatus();
  }

  notifyEncodingStarted(rasterId: string): void {
    if (this.disposed) {
      return;
    }
    this.encoding.add(rasterId);
    this.setUnsaved(true);
    this.setEncodingCount();
  }

  /** Encode gave up: not "encoding" any more, but the saved PNG is stale. Surfaced as a failure. */
  notifyEncodingFailed(rasterId: string): void {
    if (this.disposed) {
      return;
    }
    this.encoding.delete(rasterId);
    this.failedEncodes.add(rasterId);
    this.emitStatus();
  }

  /** Encode no longer applies (raster gone or replaced); stop reporting it as in flight. */
  notifyEncodingAborted(rasterId: string): void {
    if (this.disposed) {
      return;
    }
    const had = this.encoding.delete(rasterId);
    const hadFailed = this.failedEncodes.delete(rasterId);
    if (had || hadFailed) {
      this.emitStatus();
    }
  }

  getFailedEncodeIds(): string[] {
    return [...this.failedEncodes];
  }

  notifyEncodingComplete(rasterId: string, _buffer: ArrayBuffer): void {
    if (this.disposed) {
      return;
    }
    this.failedEncodes.delete(rasterId);
    this.encoding.delete(rasterId);
    this.setEncodingCount();
  }

  markUnsaved(): void {
    if (this.disposed) {
      return;
    }
    this.setUnsaved(true);
  }

  /**
   * Tool size / opacity changes should not start a new autosave.
   * If a write is already queued, keep its debounce and persist the latest document JSON with it.
   */
  updatePendingDocument(doc: EditorDocument): void {
    if (this.disposed) {
      return;
    }
    const cloned = cloneEditorDocument(doc);
    if (this.pendingJob) {
      this.pendingJob.doc = cloned;
    }
    if (this.queuedAfterRun) {
      this.queuedAfterRun.doc = cloned;
    }
  }

  scheduleSave(doc: EditorDocument, dirtyRasterIds: Iterable<string>, viewOnly = false): void {
    if (this.disposed) {
      return;
    }
    this.saveGen += 1;
    const gen = this.saveGen;
    const dirty = new Set(this.pendingJob?.dirtyRasterIds);
    if (this.queuedAfterRun) {
      for (const id of this.queuedAfterRun.dirtyRasterIds) {
        dirty.add(id);
      }
    }
    for (const id of dirtyRasterIds) {
      dirty.add(id);
    }
    const mergedViewOnly =
      viewOnly &&
      (this.pendingJob?.viewOnly ?? true) &&
      (this.queuedAfterRun?.viewOnly ?? true) &&
      dirty.size === 0;
    this.pendingJob = {
      saveGen: gen,
      doc: cloneEditorDocument(doc),
      dirtyRasterIds: dirty,
      viewOnly: mergedViewOnly,
    };
    this.setUnsaved(true);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    const delays = this.getDelays();
    const documentMs = Number.isFinite(delays.documentMs) ? delays.documentMs : DOCUMENT_SAVE_DEBOUNCE_MS;
    const viewOnlyMs = Number.isFinite(delays.viewOnlyMs) ? delays.viewOnlyMs : VIEW_ONLY_SAVE_DEBOUNCE_MS;
    const delay = mergedViewOnly ? Math.max(0, viewOnlyMs) : Math.max(0, documentMs);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runLatestJob().catch(() => {
        // Failure is surfaced through status.saveFailures; the job is requeued.
      });
    }, delay);
  }

  private getPendingJob(): PendingJob | null {
    return this.pendingJob;
  }

  private async runLatestJob(): Promise<void> {
    if (!this.pendingJob) {
      return;
    }
    const job = this.pendingJob;
    this.pendingJob = null;
    if (this.runningJob) {
      this.queuedAfterRun = job;
      return;
    }
    await this.executeJob(job);
    while (this.queuedAfterRun) {
      const next = this.queuedAfterRun;
      this.queuedAfterRun = null;
      const pendingSaveGen = this.getPendingJob()?.saveGen;
      if (pendingSaveGen === undefined || next.saveGen >= pendingSaveGen) {
        await this.executeJob(next);
      }
    }
    if (this.pendingJob) {
      await this.runLatestJob();
    }
  }

  private async executeJob(job: PendingJob): Promise<void> {
    const turn = this.serialTail;
    let done!: () => void;
    this.serialTail = new Promise<void>((resolve) => {
      done = resolve;
    });
    await turn;
    this.runningJob = job;
    try {
      const encoded = this.getEncodedPng();
      const rasters = new Map<string, ArrayBuffer>();
      for (const rasterId of job.dirtyRasterIds) {
        const png = encoded.get(rasterId);
        if (png && png.byteLength > 0) {
          rasters.set(rasterId, png.slice(0));
        }
      }
      const updatedAt = new Date().toISOString();
      const meta: ProjectMeta = {
        id: job.doc.projectId,
        name: job.doc.name,
        updatedAt,
        pageCount: Object.keys(job.doc.pages).length,
      };
      await this.commitWithTimeout({
        document: job.doc,
        meta,
        rasters,
        snapshot: 'guarded',
      });
      void requestPersistentStorage();
      this.setFailures(0);
      if (job.saveGen === this.saveGen) {
        this.setUnsaved(false);
      }
    } catch (err) {
      this.requeueFailedJob(job);
      this.setFailures(this.failures + 1);
      // #region agent log
      ipadDebugLog({
        sessionId: 'adcc47',
        ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
        hypothesisId: 'F',
        location: 'autosave.ts:executeJob',
        message: 'executeJob failed',
        data: {
          name: err instanceof Error ? err.name : typeof err,
          msg: err instanceof Error ? err.message : String(err),
        },
      });
      // #endregion
      throw err;
    } finally {
      this.runningJob = null;
      done();
    }
  }

  private commitWithTimeout(input: Parameters<StorageDatabase['commitDocumentGeneration']>[0]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new AutosaveCommitTimeoutError()), this.commitTimeoutMs);
      this.db.commitDocumentGeneration(input).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private setFailures(value: number): void {
    if (this.failures === value) {
      return;
    }
    this.failures = value;
    this.emitStatus();
  }

  /** Keep a failed write so the next attempt (retry or newer save) still carries its dirty rasters. */
  private requeueFailedJob(job: PendingJob): void {
    const pending = this.pendingJob;
    if (pending) {
      for (const id of job.dirtyRasterIds) {
        pending.dirtyRasterIds.add(id);
      }
      pending.viewOnly = pending.viewOnly && job.viewOnly && pending.dirtyRasterIds.size === 0;
      return;
    }
    this.pendingJob = job;
  }

  /** Manual retry after a failure. Resolves true when everything pending was written. */
  async retry(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    try {
      await this.flushRouteLeave();
      return true;
    } catch {
      return false;
    }
  }

  async flushRouteLeave(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (;;) {
      await this.serialTail;
      if (!this.pendingJob && !this.queuedAfterRun) {
        break;
      }
      if (this.pendingJob) {
        await this.runLatestJob();
        continue;
      }
      const next = this.queuedAfterRun;
      this.queuedAfterRun = null;
      const pendingSaveGen = this.getPendingJob()?.saveGen;
      if (pendingSaveGen === undefined || next!.saveGen >= pendingSaveGen) {
        await this.executeJob(next!);
      }
    }
  }

  /**
   * §7.6 hidden/pagehide: put in-memory encoded PNG only. Never start convertToBlob here.
   * Also writes the pending document JSON so a reload does not drop unsaved clips.
   * Must NEVER update generation snapshots — unordered puts can tear live JSON/PNGs.
   */
  flushHidden(): void {
    const encoded = this.getEncodedPng();
    for (const [rasterId, png] of encoded.entries()) {
      if (png.byteLength > 0) {
        void this.db.putRaster(rasterId, png.slice(0)).catch((err) => {
          // #region agent log
          ipadDebugLog({
            sessionId: 'adcc47',
            ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
            hypothesisId: 'F',
            location: 'autosave.ts:flushHidden',
            message: 'flushHidden putRaster failed',
            data: {
              name: err instanceof Error ? err.name : typeof err,
              msg: err instanceof Error ? err.message : String(err),
            },
          });
          // #endregion
        });
      }
    }
    const pendingDoc = this.pendingJob?.doc;
    if (pendingDoc) {
      const updatedAt = new Date().toISOString();
      const ignoreClosing = (err: unknown) => {
        if (err instanceof DOMException && err.name === 'InvalidStateError') {
          return;
        }
        // #region agent log
        ipadDebugLog({
          sessionId: 'adcc47',
          ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
          hypothesisId: 'F',
          location: 'autosave.ts:flushHidden',
          message: 'flushHidden doc/meta failed',
          data: {
            name: err instanceof Error ? err.name : typeof err,
            msg: err instanceof Error ? err.message : String(err),
          },
        });
        // #endregion
      };
      void this.db.putDocument(pendingDoc).catch(ignoreClosing);
      void this.db.putMeta({
        id: pendingDoc.projectId,
        name: pendingDoc.name,
        updatedAt,
        pageCount: Object.keys(pendingDoc.pages).length,
      }).catch(ignoreClosing);
    }
  }

  resumePendingEncodes(restart: (rasterId: string) => void): void {
    for (const rasterId of this.encoding) {
      restart(rasterId);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
