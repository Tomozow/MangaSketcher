import { DOWNLOAD_OBJECT_URL_REVOKE_MS } from './constants';
import { isAbortError, WorkspaceExportError } from './errors';

export type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

export type TimerHandle = ReturnType<typeof setTimeout> | number;

export type ObjectUrlTracker = {
  url: string;
  usedForDownload: boolean;
  revokeTimer: TimerHandle | null;
};

export function canShareExportFile(file: File, nav: ShareNavigator | undefined = globalThis.navigator): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') {
    return false;
  }
  try {
    return nav.canShare({ files: [file] }) === true;
  } catch {
    return false;
  }
}

export async function shareExportFile(
  file: File,
  nav: ShareNavigator | undefined = globalThis.navigator,
): Promise<'shared' | 'aborted'> {
  if (!nav || typeof nav.share !== 'function') {
    throw new WorkspaceExportError();
  }
  try {
    await nav.share({ files: [file] });
    return 'shared';
  } catch (err) {
    if (isAbortError(err)) {
      return 'aborted';
    }
    throw new WorkspaceExportError();
  }
}

export function scheduleDownloadUrlRevoke(
  url: string,
  options: {
    revokeMs?: number;
    revoke?: (objectUrl: string) => void;
    schedule?: (callback: () => void, ms: number) => TimerHandle;
  } = {},
): TimerHandle {
  const revokeMs = options.revokeMs ?? DOWNLOAD_OBJECT_URL_REVOKE_MS;
  const revoke = options.revoke ?? ((objectUrl) => URL.revokeObjectURL(objectUrl));
  const schedule = options.schedule ?? setTimeout;
  return schedule(() => revoke(url), revokeMs);
}

export function revokeExportObjectUrl(
  tracker: ObjectUrlTracker | null,
  options: { unusedOnly?: boolean } = {},
): void {
  if (!tracker) {
    return;
  }
  if (options.unusedOnly && tracker.usedForDownload) {
    return;
  }
  if (tracker.revokeTimer != null) {
    clearTimeout(tracker.revokeTimer);
    tracker.revokeTimer = null;
  }
  URL.revokeObjectURL(tracker.url);
}

export function clickDownloadAnchor(file: File, url: string, doc: Document = document): void {
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = 'noopener';
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function startExportDownload(
  file: File,
  options: {
    createObjectUrl?: (blob: Blob) => string;
    click?: (exportFile: File, url: string) => void;
    scheduleRevoke?: (url: string) => TimerHandle;
  } = {},
): ObjectUrlTracker {
  const createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
  const click = options.click ?? clickDownloadAnchor;
  const url = createObjectUrl(file);
  click(file, url);
  const revokeTimer =
    options.scheduleRevoke?.(url) ?? scheduleDownloadUrlRevoke(url);
  return {
    url,
    usedForDownload: true,
    revokeTimer,
  };
}
