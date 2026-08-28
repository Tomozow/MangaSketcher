import type { ProjectMeta, EditorDocument } from '../types';
import type { StorageDatabase } from './idb';

export class MemoryStorageDatabase implements StorageDatabase {
  readonly meta = new Map<string, ProjectMeta>();
  readonly documents = new Map<string, EditorDocument>();
  readonly rasters = new Map<string, ArrayBuffer>();
  failDeleteProjectRecords = false;

  async listMeta(): Promise<ProjectMeta[]> {
    return [...this.meta.values()];
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
}
