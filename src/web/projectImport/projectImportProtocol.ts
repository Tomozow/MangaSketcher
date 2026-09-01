import type { EditorDocument } from '@/src/storage/types';
import type { ProjectImportProgress } from '@/src/storage/prepareImportedProject';

export type ProjectImportWorkerRequest = {
  type: 'start';
  zip: ArrayBuffer;
  newProjectId: string;
};

export type ProjectImportWorkerProgress = Extract<ProjectImportProgress, { phase: 'unzip' | 'normalize' }>;

export type ProjectImportWorkerResponse =
  | ({ type: 'progress' } & ProjectImportWorkerProgress)
  | { type: 'done'; document: EditorDocument; rasters: [string, ArrayBuffer][] }
  | { type: 'error'; message: string };
