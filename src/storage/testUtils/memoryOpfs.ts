import type { OpfsStorage } from '../opfs';

export class MemoryOpfsStorage implements OpfsStorage {
  readonly files = new Map<string, ArrayBuffer>();
  failDelete = false;

  private key(projectId: string): string {
    return projectId;
  }

  async writePdf(projectId: string, data: ArrayBuffer): Promise<void> {
    this.files.set(this.key(projectId), data.slice(0));
  }

  async readPdf(projectId: string): Promise<File | null> {
    const data = this.files.get(this.key(projectId));
    if (!data) {
      return null;
    }
    return new File([data], `${projectId}.pdf`, { type: 'application/pdf' });
  }

  async deletePdf(projectId: string): Promise<void> {
    if (this.failDelete) {
      throw new Error('simulated opfs delete failure');
    }
    this.files.delete(this.key(projectId));
  }

  async listPdfProjectIds(): Promise<string[]> {
    return [...this.files.keys()];
  }
}
