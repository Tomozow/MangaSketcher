import type { EditorDocument, ProjectMeta } from '../types';
import { APP_SETTINGS_META_ID } from '../types';
import { collectRasterIds } from '../rasterIds';
import type { ProjectExportSnapshot, ProjectImportPayload, StorageDatabase } from './idb';

export class MemoryStorageDatabase implements StorageDatabase {
  readonly meta = new Map<string, ProjectMeta>();
  readonly documents = new Map<string, EditorDocument>();
  readonly rasters = new Map<string, ArrayBuffer>();
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
    const doc = this.documents.get(id);
    return doc ? structuredClone(doc) : undefined;
  }

  async putDocument(doc: EditorDocument): Promise<void> {
    this.documents.set(doc.projectId, structuredClone(doc));
  }

  async deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
  }

  async getRaster(rasterId: string): Promise<ArrayBuffer | undefined> {
    const png = this.rasters.get(rasterId);
    return png ? png.slice(0) : undefined;
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
    this.documents.delete(projectId);
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
    try {
      for (const [rasterId, png] of payload.rasters.entries()) {
        this.rasters.set(rasterId, png.slice(0));
      }
      this.documents.set(payload.document.projectId, structuredClone(payload.document));
      this.meta.set(payload.meta.id, { ...payload.meta });
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
      throw err;
    }
  }
}
