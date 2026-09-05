import type { EditorDocument, ProjectMeta } from '../types';
import { APP_SETTINGS_META_ID } from '../types';
import { collectRasterIds } from '../rasterIds';
import {
  documentLiveRastersAreValid,
  isQuotaExceededError,
  rasterToArrayBuffer,
  snapshotGuardPasses,
  snapshotRastersToPut,
  stripStoredDocument,
  type CommitDocumentGenerationInput,
  type CommitDocumentGenerationResult,
} from '../generationSnapshot';
import type { ProjectExportSnapshot, ProjectImportPayload, StorageDatabase } from '../idb';

export class MemoryStorageDatabase implements StorageDatabase {
  readonly meta = new Map<string, ProjectMeta>();
  readonly documents = new Map<string, EditorDocument>();
  readonly rasters = new Map<string, ArrayBuffer | Blob | unknown>();
  readonly documentSnapshots = new Map<string, EditorDocument & { id: string }>();
  readonly rasterSnapshots = new Map<string, ArrayBuffer | Blob | unknown>();
  failDeleteProjectRecords = false;
  failImportProjectAtomic = false;
  failSnapshotQuota = false;

  async listMeta(): Promise<ProjectMeta[]> {
    return [...this.meta.values()].filter((item) => item.id !== APP_SETTINGS_META_ID);
  }

  async getMeta(id: string): Promise<ProjectMeta | undefined> {
    return this.meta.get(id);
  }

  async putMeta(meta: ProjectMeta): Promise<void> {
    this.meta.set(meta.id, { ...meta });
  }

  async deleteMeta(id: string): Promise<void> {
    this.meta.delete(id);
  }

  async getDocument(id: string): Promise<EditorDocument | undefined> {
    const stored = this.documents.get(id);
    if (!stored) {
      return undefined;
    }
    return structuredClone(stored);
  }

  async putDocument(doc: EditorDocument): Promise<void> {
    this.documents.set(doc.projectId, structuredClone(doc));
  }

  async deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async getRaster(rasterId: string): Promise<ArrayBuffer | undefined> {
    return rasterToArrayBuffer(this.rasters.get(rasterId));
  }

  async putRaster(rasterId: string, png: ArrayBuffer): Promise<void> {
    this.rasters.set(rasterId, png.slice(0));
  }

  async deleteRaster(rasterId: string): Promise<void> {
    this.rasters.delete(rasterId);
  }

  async listRasterIds(): Promise<string[]> {
    return [...this.rasters.keys()];
  }

  async getSnapshotDocument(id: string): Promise<EditorDocument | undefined> {
    const stored = this.documentSnapshots.get(id);
    const stripped = stripStoredDocument(stored);
    return stripped ? structuredClone(stripped) : undefined;
  }

  async getSnapshotRaster(rasterId: string): Promise<ArrayBuffer | undefined> {
    return rasterToArrayBuffer(this.rasterSnapshots.get(rasterId));
  }

  async listSnapshotRasterIds(): Promise<string[]> {
    return [...this.rasterSnapshots.keys()];
  }

  async commitDocumentGeneration(
    input: CommitDocumentGenerationInput,
  ): Promise<CommitDocumentGenerationResult> {
    const payload = input.rasters ?? new Map<string, ArrayBuffer>();
    const mode = input.snapshot ?? 'guarded';
    const liveBefore = new Map<string, ArrayBuffer>();
    for (const rasterId of collectRasterIds(input.document)) {
      const png = await this.getRaster(rasterId);
      if (png) {
        liveBefore.set(rasterId, png);
      }
    }

    for (const [rasterId, png] of payload.entries()) {
      await this.putRaster(rasterId, png);
    }
    await this.putDocument(input.document);
    await this.putMeta(input.meta);

    if (mode === 'none') {
      return { snapshotUpdated: false };
    }

    try {
      if (this.failSnapshotQuota) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }

      if (mode === 'name-only') {
        const liveOk = await documentLiveRastersAreValid((id) => this.getRaster(id), input.document);
        if (!liveOk) {
          return { snapshotUpdated: false };
        }
        const snap = await this.getSnapshotDocument(input.document.projectId);
        if (!snap) {
          return { snapshotUpdated: false };
        }
        snap.name = input.document.name;
        this.documentSnapshots.set(snap.projectId, { ...structuredClone(snap), id: snap.projectId });
        return { snapshotUpdated: true };
      }

      if (!snapshotGuardPasses(input.document, payload, liveBefore)) {
        return { snapshotUpdated: false };
      }

      const existingSnapshot = new Map<string, ArrayBuffer>();
      for (const rasterId of collectRasterIds(input.document)) {
        const png = await this.getSnapshotRaster(rasterId);
        if (png) {
          existingSnapshot.set(rasterId, png);
        }
      }
      const toPut = snapshotRastersToPut(input.document, payload, liveBefore, existingSnapshot);
      this.documentSnapshots.set(input.document.projectId, {
        ...structuredClone(input.document),
        id: input.document.projectId,
      });
      for (const [rasterId, png] of toPut.entries()) {
        this.rasterSnapshots.set(rasterId, png.slice(0));
      }
      const prefix = `${input.document.projectId}:`;
      const keep = new Set(collectRasterIds(input.document));
      for (const key of [...this.rasterSnapshots.keys()]) {
        if (key.startsWith(prefix) && !keep.has(key)) {
          this.rasterSnapshots.delete(key);
        }
      }
      return { snapshotUpdated: true };
    } catch (err) {
      if (isQuotaExceededError(err) || this.failSnapshotQuota) {
        return { snapshotUpdated: false };
      }
      return { snapshotUpdated: false };
    }
  }

  async deleteProjectRecords(projectId: string): Promise<void> {
    if (this.failDeleteProjectRecords) {
      throw new Error('simulated idb delete failure');
    }
    const prefix = `${projectId}:`;
    for (const key of [...this.rasters.keys()]) {
      if (key.startsWith(prefix)) {
        this.rasters.delete(key);
      }
    }
    for (const key of [...this.rasterSnapshots.keys()]) {
      if (key.startsWith(prefix)) {
        this.rasterSnapshots.delete(key);
      }
    }
    this.documents.delete(projectId);
    this.documentSnapshots.delete(projectId);
    this.meta.delete(projectId);
  }

  async readProjectExportSnapshot(projectId: string): Promise<ProjectExportSnapshot | null> {
    const doc = await this.getDocument(projectId);
    if (!doc) {
      return null;
    }
    const rasterIds = collectRasterIds(doc);
    const rasters = new Map<string, ArrayBuffer>();
    for (const rasterId of rasterIds) {
      const png = await this.getRaster(rasterId);
      if (png) {
        rasters.set(rasterId, png.slice(0));
      }
    }
    return { document: doc, rasters };
  }

  async importProjectAtomic(payload: ProjectImportPayload): Promise<void> {
    if (this.failImportProjectAtomic) {
      throw new Error('simulated import failure');
    }
    const rasterBackup = new Map(this.rasters);
    const documentsBackup = new Map(this.documents);
    const metaBackup = new Map(this.meta);
    const documentSnapshotsBackup = new Map(this.documentSnapshots);
    const rasterSnapshotsBackup = new Map(this.rasterSnapshots);
    try {
      await this.commitDocumentGeneration({
        document: payload.document,
        rasters: payload.rasters,
        meta: payload.meta,
        snapshot: 'guarded',
      });
    } catch (err) {
      this.rasters.clear();
      for (const [key, value] of rasterBackup) {
        this.rasters.set(key, value);
      }
      this.documents.clear();
      for (const [key, value] of documentsBackup) {
        this.documents.set(key, value);
      }
      this.meta.clear();
      for (const [key, value] of metaBackup) {
        this.meta.set(key, value);
      }
      this.documentSnapshots.clear();
      for (const [key, value] of documentSnapshotsBackup) {
        this.documentSnapshots.set(key, value);
      }
      this.rasterSnapshots.clear();
      for (const [key, value] of rasterSnapshotsBackup) {
        this.rasterSnapshots.set(key, value);
      }
      throw err;
    }
  }
}
