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
import { collectRasterIds } from './rasterIds';

export type AutosaveStatus = {
  unsaved: boolean;
  encodingCount: number;
  /** Consecutive failed / timed-out writes. Omitted while healthy. */
  saveFailures?: number;
};

/** A commit that has not settled by then is treated as hung and failed. */
export const COMMIT_TIMEOUT_MS = 30_000;

/**
 * How long a save waits for running encodes so their PNGs go out with it. After that it goes ahead
 * without them, unless the document needs one of them (see `notifyDocumentNeeds`).
 */
export const ENCODE_SETTLE_MAX_MS = 15_000;
const ENCODE_SETTLE_POLL_MS = 50;

export class AutosaveCommitTimeoutError extends Error {
  constructor() {
    super('autosave commit timed out');
    this.name = 'AutosaveCommitTimeoutError';
  }
}

/** A raster the document depends on has no fresh PNG yet (encode running or given up). */
export class AutosaveEncodePendingError extends Error {
  constructor() {
    super('autosave waiting for raster encodes');
    this.name = 'AutosaveEncodePendingError';
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
  encodeSettleMaxMs?: number;
  /** PNGs as loaded from storage at boot. Rasters still byte-equal to these are not written again. */
  storedPng?: ReadonlyMap<string, ArrayBuffer>;
};

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a === b) {
    return true;
  }
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] !== y[i]) {
      return false;
    }
  }
  return true;
}

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
  private readonly explicitDb?: StorageDatabase;
  private readonly getEncodedPng: () => ReadonlyMap<string, ArrayBuffer>;
  private readonly onStatusChange?: (status: AutosaveStatus) => void;
  private readonly getDelays: () => AutosaveDelays;

  private saveGen = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingJob: PendingJob | null = null;
  private runningJob: PendingJob | null = null;
  private queuedAfterRun: PendingJob | null = null;
  private serialTail: Promise<void> = Promise.resolve();
  /** Rasters whose stored PNG is behind their pixels: encode running, or given up. */
  private readonly unsettled = new Map<string, 'encoding' | 'failed'>();
  /**
   * Rasters whose fresh PNG the document depends on: created, consumed or restored by an edit that
   * also changed the document (cut, bake, merge, undo). Saving the document before their PNG would
   * store a state that never existed. A plain stroke is not in here: the document does not depend
   * on it, so the rest can be saved while it encodes.
   */
  private readonly docNeeds = new Set<string>();
  private unsaved = false;
  private disposed = false;
  private failures = 0;
  private readonly commitTimeoutMs: number;
  private readonly encodeSettleMaxMs: number;
  /**
   * PNG buffer known to be stored per raster (by identity). Only buffers that differ are written.
   */
  private committed = new Map<string, ArrayBuffer>();
  private storedPng: ReadonlyMap<string, ArrayBuffer> | undefined;

  constructor(options: AutosaveManagerOptions) {
    this.explicitDb = options.db;
    this.getEncodedPng = options.getEncodedPng;
    this.onStatusChange = options.onStatusChange;
    this.commitTimeoutMs = options.commitTimeoutMs ?? COMMIT_TIMEOUT_MS;
    this.encodeSettleMaxMs = options.encodeSettleMaxMs ?? ENCODE_SETTLE_MAX_MS;
    this.storedPng = options.storedPng;
    this.getDelays =
      options.getDelays ??
      (() => ({
        documentMs: DOCUMENT_SAVE_DEBOUNCE_MS,
        viewOnlyMs: VIEW_ONLY_SAVE_DEBOUNCE_MS,
      }));
  }

  /**
   * Resolved per use: pagehide / navigation closes the shared connection, and a manager that
   * kept the old handle would fail every later save with "database connection is closing".
   */
  private get db(): StorageDatabase {
    return this.explicitDb ?? getDefaultStorageDatabase();
  }

  getStatus(): AutosaveStatus {
    const status: AutosaveStatus = { unsaved: this.unsaved, encodingCount: this.idsIn('encoding').length };
    const failures = this.failures + this.idsIn('failed').length;
    if (failures > 0) {
      status.saveFailures = failures;
    }
    return status;
  }

  private idsIn(state: 'encoding' | 'failed'): string[] {
    return [...this.unsettled].filter(([, value]) => value === state).map(([rasterId]) => rasterId);
  }

  /** The document cannot be saved yet: a raster it depends on has no fresh PNG. */
  private blocked(): boolean {
    for (const rasterId of this.docNeeds) {
      if (this.unsettled.has(rasterId)) {
        return true;
      }
    }
    return false;
  }

  notifyDocumentNeeds(rasterIds: readonly string[]): void {
    for (const rasterId of rasterIds) {
      this.docNeeds.add(rasterId);
    }
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
    this.unsettled.set(rasterId, 'encoding');
    this.setUnsaved(true);
    this.setEncodingCount();
  }

  /** Encode gave up: not "encoding" any more, but the saved PNG is stale. Surfaced as a failure. */
  notifyEncodingFailed(rasterId: string): void {
    if (this.disposed) {
      return;
    }
    this.unsettled.set(rasterId, 'failed');
    this.emitStatus();
  }

  /** Encode no longer applies (raster gone or replaced); stop reporting it as in flight. */
  notifyEncodingAborted(rasterId: string): void {
    if (this.disposed) {
      return;
    }
    this.docNeeds.delete(rasterId);
    if (this.unsettled.delete(rasterId)) {
      this.emitStatus();
    }
  }

  getFailedEncodeIds(): string[] {
    return this.idsIn('failed');
  }

  notifyEncodingComplete(rasterId: string, _buffer: ArrayBuffer): void {
    if (this.disposed) {
      return;
    }
    this.unsettled.delete(rasterId);
    this.docNeeds.delete(rasterId);
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
      await this.waitForEncodesSettled();
      const newer = this.pendingJob;
      if (newer && newer.saveGen > job.saveGen) {
        // A later save already carries the latest document; fold this one's rasters into it.
        for (const id of job.dirtyRasterIds) {
          newer.dirtyRasterIds.add(id);
        }
        newer.viewOnly = newer.viewOnly && newer.dirtyRasterIds.size === 0;
        return;
      }
      if (this.blocked()) {
        // The job stays queued; the encode's completion schedules the next attempt.
        throw new AutosaveEncodePendingError();
      }
      const { rasters, sources } = this.changedRasters(job.doc);
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
      this.noteCommitted(job.doc, sources);
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

  /**
   * PNGs this save must write: every raster of the document whose current PNG is not the one known
   * to be stored. Not just the dirty ones: a clip brought back by undo is not dirty, but its stored
   * revision may already have been dropped. `sources` keeps the uncopied buffers for noteCommitted.
   */
  private changedRasters(doc: EditorDocument): {
    rasters: Map<string, ArrayBuffer>;
    sources: Map<string, ArrayBuffer>;
  } {
    const encoded = this.getEncodedPng();
    const rasterIds = collectRasterIds(doc);
    if (this.storedPng) {
      // First save of the session: what still equals the bytes boot loaded is already stored.
      for (const rasterId of rasterIds) {
        const png = encoded.get(rasterId);
        const stored = this.storedPng.get(rasterId);
        if (png && stored && sameBytes(png, stored)) {
          this.committed.set(rasterId, png);
        }
      }
      this.storedPng = undefined;
    }
    const rasters = new Map<string, ArrayBuffer>();
    const sources = new Map<string, ArrayBuffer>();
    for (const rasterId of rasterIds) {
      const png = encoded.get(rasterId);
      if (png && png.byteLength > 0 && this.committed.get(rasterId) !== png) {
        rasters.set(rasterId, png.slice(0));
        sources.set(rasterId, png);
      }
    }
    return { rasters, sources };
  }

  private noteCommitted(doc: EditorDocument, sources: ReadonlyMap<string, ArrayBuffer>): void {
    const next = new Map<string, ArrayBuffer>();
    for (const rasterId of collectRasterIds(doc)) {
      const png = sources.get(rasterId) ?? this.committed.get(rasterId);
      if (png) {
        next.set(rasterId, png);
      }
    }
    this.committed = next;
  }

  private async waitForEncodesSettled(): Promise<void> {
    const startedAt = Date.now();
    while (
      this.idsIn('encoding').length > 0 &&
      !this.disposed &&
      Date.now() - startedAt < this.encodeSettleMaxMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, ENCODE_SETTLE_POLL_MS));
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
    if (this.blocked()) {
      // The document depends on a PNG that is not ready; keep the last stored generation instead.
      return;
    }
    const atomicDoc = this.pendingJob?.doc;
    if (atomicDoc) {
      // One transaction: PNGs and the document that references them land together or not at all.
      const { rasters, sources } = this.changedRasters(atomicDoc);
      void this.db
        .putLiveAtomic({
          document: atomicDoc,
          meta: {
            id: atomicDoc.projectId,
            name: atomicDoc.name,
            updatedAt: new Date().toISOString(),
            pageCount: Object.keys(atomicDoc.pages).length,
          },
          rasters,
        })
        .then(() => this.noteCommitted(atomicDoc, sources))
        .catch(() => {
          // The page is going away; the next boot falls back to the last whole generation.
        });
    }
  }

  resumePendingEncodes(restart: (rasterId: string) => void): void {
    for (const rasterId of this.idsIn('encoding')) {
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
