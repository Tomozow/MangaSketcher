import { EXPORT_FAILED_MESSAGE } from './constants';

export class WorkspaceExportError extends Error {
  constructor(message = EXPORT_FAILED_MESSAGE) {
    super(message);
    this.name = 'WorkspaceExportError';
  }
}

export class WorkspaceExportAbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'WorkspaceExportAbortedError';
  }
}

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WorkspaceExportAbortedError();
  }
}
