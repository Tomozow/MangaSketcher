import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { exportWorkspace, type ExportProgress, type ExportWorkspaceDeps } from './exportWorkspace';

export type RunExportGenerationInput = {
  doc: EditorDocument;
  inkEngine: InkEngine;
  onBeforeExport?: () => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  deps?: ExportWorkspaceDeps;
};

export async function runExportGeneration(input: RunExportGenerationInput): Promise<File> {
  if (input.onBeforeExport) {
    await input.onBeforeExport();
  }
  return exportWorkspace(input.doc, input.inkEngine, {
    signal: input.signal,
    onProgress: input.onProgress,
    ...input.deps,
  });
}
