import type { EditorDocument, ProjectMeta } from '../types';
import { APP_SETTINGS_META_ID } from '../types';
import { collectRasterIds } from '../rasterIds';
import {
  documentRasterKey,
  planGeneration,
  rasterToArrayBuffer,
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
  /** Raster ids written by each commit, in order. */
  readonly commits: string[][] = [];
  /** Awaited at the start of every commit (lets a test hold a save open). */
  beforeCommit: (() => Promise<void>) | null = null;
  failDeleteProjectRecords = false;
  failImportProjectAtomic = false;

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

  /** Raw write of the live document JSON. Storage-owned fields of the stored document are kept. */
  async putDocument(doc: EditorDocument): Promise<void> {
    const stored = this.documents.get(doc.projectId);
    this.documents.set(doc.projectId, {
      ...structuredClone(doc),
      ...(stored ? { generation: stored.generation, rasterRevs: stored.rasterRevs } : {}),
    });
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

  /** The PNG the stored live document uses for `rasterId`. */
  async liveRaster(rasterId: string): Promise<ArrayBuffer | undefined> {
    const doc = this.documents.get(rasterId.split(':')[0]!);
    return doc ? this.getRaster(documentRasterKey(doc, rasterId)) : undefined;
  }

  /** Replace the PNG the stored live document uses for `rasterId` (simulates damage / old data). */
  setLiveRaster(rasterId: string, value: ArrayBuffer | Blob): void {
    const doc = this.documents.get(rasterId.split(':')[0]!);
    this.rasters.set(doc ? documentRasterKey(doc, rasterId) : rasterId, value);
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
    const projectId = input.document.projectId;
    await this.beforeCommit?.();
    // Plan first: a throw leaves every map untouched, like an aborted transaction.
    const plan = planGeneration(
      this.documents.get(projectId),
      stripStoredDocument(this.documentSnapshots.get(projectId)),
      input,
    );
    for (const [key, png] of plan.puts) {
      this.rasters.set(key, png.slice(0));
    }
    this.commits.push([...(input.rasters?.keys() ?? [])].filter((id) => plan.document.rasterRevs?.[id] === plan.document.generation));
    for (const key of plan.deletes) {
      this.rasters.delete(key);
    }
    if (plan.snapshot) {
      this.documentSnapshots.set(projectId, { ...structuredClone(plan.snapshot), id: projectId });
    }
    this.documents.set(projectId, structuredClone(plan.document));
    this.meta.set(input.meta.id, { ...input.meta });
    return { snapshotUpdated: true };
  }

  async putLiveAtomic(input: {
    document: EditorDocument;
    meta: ProjectMeta;
    rasters: ReadonlyMap<string, ArrayBuffer>;
  }): Promise<void> {
    await this.commitDocumentGeneration(input);
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
    const stored = await this.getDocument(projectId);
    if (!stored) {
      return null;
    }
    const rasterIds = collectRasterIds(stored);
    const rasters = new Map<string, ArrayBuffer>();
    for (const rasterId of rasterIds) {
      const png = await this.getRaster(documentRasterKey(stored, rasterId));
      if (png) {
        rasters.set(rasterId, png.slice(0));
      }
    }
    const { generation: _generation, rasterRevs: _rasterRevs, ...doc } = stored;
    return { document: doc as EditorDocument, rasters };
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
