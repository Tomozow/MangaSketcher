import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { exportWorkspace, type ExportProgress, type ExportWorkspaceDeps } from './exportWorkspace';
import type { PageScopeMode } from './exportFormat';

export type RunExportGenerationInput = {
  doc: EditorDocument;
  inkEngine: InkEngine;
  onBeforeExport?: () => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  deps?: ExportWorkspaceDeps;
  pageIds?: EditorDocument['workspaceOrder'];
  pick?: PageScopeMode;
};

export async function runExportGeneration(input: RunExportGenerationInput): Promise<File> {
  if (input.onBeforeExport) {
    await input.onBeforeExport();
  }
  return exportWorkspace(input.doc, input.inkEngine, {
    signal: input.signal,
    onProgress: input.onProgress,
    pageIds: input.pageIds,
    pick: input.pick,
    ...input.deps,
  });
}
