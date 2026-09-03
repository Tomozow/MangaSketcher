import { DOWNLOAD_OBJECT_URL_REVOKE_MS } from './constants';

export type TimerHandle = ReturnType<typeof setTimeout> | number;

export type ObjectUrlTracker = {
  url: string;
  usedForDownload: boolean;
  revokeTimer: TimerHandle | null;
};

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
