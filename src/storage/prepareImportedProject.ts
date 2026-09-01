import { normalizePackRasterPng } from './compactInkPng';
import type { EditorDocument } from './types';
import {
  parseProjectPackZip,
  parseProjectPackZipAsync,
  ProjectPackError,
  rasterZipPathForDocumentMember,
  rewriteImportedDocument,
} from './projectPack';
import { collectRasterIds } from './rasterIds';

export type ProjectImportProgress = {
  phase: 'reading' | 'unzip' | 'normalize' | 'saving';
  current?: number;
  total?: number;
};

export type PreparedImportedProject = {
  document: EditorDocument;
  rasters: Map<string, ArrayBuffer>;
};

export type PrepareImportedProjectOptions = {
  onProgress?: (progress: ProjectImportProgress) => void;
  /** Called before each raster normalize so a main-thread fallback can paint. */
  yieldFn?: () => Promise<void>;
  /** Use fflate's async unzip (main thread fallback). Worker uses sync unzip. */
  unzipAsync?: boolean;
};

export async function prepareImportedProjectFromZip(
  zipBytes: Uint8Array,
  newProjectId: string,
  options: PrepareImportedProjectOptions = {},
): Promise<PreparedImportedProject> {
  const { onProgress, yieldFn, unzipAsync } = options;
  onProgress?.({ phase: 'unzip' });
  if (yieldFn) {
    await yieldFn();
  }
  const parsed = unzipAsync ? await parseProjectPackZipAsync(zipBytes) : parseProjectPackZip(zipBytes);
  const document = rewriteImportedDocument(parsed.document, newProjectId);
  const rasters = new Map<string, ArrayBuffer>();
  const rasterIds = collectRasterIds(document);
  let index = 0;
  for (const rasterId of rasterIds) {
    index += 1;
    onProgress?.({ phase: 'normalize', current: index, total: rasterIds.length });
    if (yieldFn) {
      await yieldFn();
    }
    const zipPath = rasterZipPathForDocumentMember(document, rasterId);
    const png = parsed.rasters.get(zipPath);
    if (!png) {
      throw new ProjectPackError('ラスターデータが不足しています。');
    }
    rasters.set(rasterId, normalizePackRasterPng(png.slice(0)));
  }
  return { document, rasters };
}
