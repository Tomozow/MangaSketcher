import {
  DOCUMENT_SAVE_DEBOUNCE_MS,
  VIEW_ONLY_SAVE_DEBOUNCE_MS,
  type EditorDocument,
  type ProjectMeta,
} from './types';
import { cloneEditorDocument } from './editorDocument';
import type { StorageDatabase } from './idb';
import { getDefaultStorageDatabase } from './idb';

export type AutosaveStatus = {
  unsaved: boolean;
  encodingCount: number;
};

export type AutosaveManagerOptions = {
  db?: StorageDatabase;
  getEncodedPng: () => ReadonlyMap<string, ArrayBuffer>;
  onStatusChange?: (status: AutosaveStatus) => void;
};

type PendingJob = {
  saveGen: number;
  doc: EditorDocument;
  dirtyRasterIds: Set<string>;
  viewOnly: boolean;
};

function sameStatus(a: AutosaveStatus, b: AutosaveStatus): boolean {
  return a.unsaved === b.unsaved && a.encodingCount === b.encodingCount;
}

export class AutosaveManager {
  private readonly db: StorageDatabase;
  private readonly getEncodedPng: () => ReadonlyMap<string, ArrayBuffer>;
  private readonly onStatusChange?: (status: AutosaveStatus) => void;

  private saveGen = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingJob: PendingJob | null = null;
  private runningJob: PendingJob | null = null;
  private queuedAfterRun: PendingJob | null = null;
  private encoding = new Set<string>();
  private unsaved = false;
  private disposed = false;

  constructor(options: AutosaveManagerOptions) {
    this.db = options.db ?? getDefaultStorageDatabase();
    this.getEncodedPng = options.getEncodedPng;
    this.onStatusChange = options.onStatusChange;
  }

  getStatus(): AutosaveStatus {
    return { unsaved: this.unsaved, encodingCount: this.encoding.size };
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

  notifyEncodingComplete(rasterId: string, _buffer: ArrayBuffer): void {
    if (this.disposed) {
      return;
    }
    this.encoding.delete(rasterId);
    this.setEncodingCount();
  }

  scheduleSave(doc: EditorDocument, dirtyRasterIds: Iterable<string>, viewOnly = false): void {
    if (this.disposed) {
      return;
    }
    this.saveGen += 1;
    const gen = this.saveGen;
    const dirty = new Set(dirtyRasterIds);
    this.pendingJob = {
      saveGen: gen,
      doc: cloneEditorDocument(doc),
      dirtyRasterIds: dirty,
      viewOnly,
    };
    this.setUnsaved(true);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    const delay = viewOnly ? VIEW_ONLY_SAVE_DEBOUNCE_MS : DOCUMENT_SAVE_DEBOUNCE_MS;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runLatestJob();
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
    this.runningJob = job;
    try {
      const encoded = this.getEncodedPng();
      for (const rasterId of job.dirtyRasterIds) {
        const png = encoded.get(rasterId);
        if (png) {
          await this.db.putRaster(rasterId, png.slice(0));
        }
      }
      const updatedAt = new Date().toISOString();
      const meta: ProjectMeta = {
        id: job.doc.projectId,
        name: job.doc.name,
        updatedAt,
        pageCount: Object.keys(job.doc.pages).length,
      };
      await this.db.putDocument(job.doc);
      await this.db.putMeta(meta);
      if (job.saveGen === this.saveGen) {
        this.setUnsaved(false);
      }
    } finally {
      this.runningJob = null;
    }
  }

  async flushRouteLeave(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingJob) {
      const job = this.pendingJob;
      this.pendingJob = null;
      await this.executeJob(job);
    }
    if (this.queuedAfterRun) {
      const job = this.queuedAfterRun;
      this.queuedAfterRun = null;
      await this.executeJob(job);
    }
  }

  /**
   * §7.6 hidden/pagehide: put in-memory encoded PNG only. Never start convertToBlob here.
   */
  flushHidden(): void {
    const encoded = this.getEncodedPng();
    for (const [rasterId, png] of encoded.entries()) {
      void this.db.putRaster(rasterId, png.slice(0));
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
