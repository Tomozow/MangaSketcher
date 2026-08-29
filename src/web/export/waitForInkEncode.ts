import { INK_ENCODE_POLL_MS, INK_ENCODE_WAIT_TIMEOUT_MS } from './constants';
import { WorkspaceExportError } from './errors';

export type EncodeWaitClock = {
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitUntilNotEncoding(
  isEncoding: () => boolean,
  clock: EncodeWaitClock = {},
): Promise<void> {
  const timeoutMs = clock.timeoutMs ?? INK_ENCODE_WAIT_TIMEOUT_MS;
  const pollMs = clock.pollMs ?? INK_ENCODE_POLL_MS;
  const sleep = clock.sleep ?? defaultSleep;
  const now = clock.now ?? (() => Date.now());
  const started = now();
  while (isEncoding()) {
    if (now() - started >= timeoutMs) {
      throw new WorkspaceExportError();
    }
    await sleep(pollMs);
    if (now() - started >= timeoutMs && isEncoding()) {
      throw new WorkspaceExportError();
    }
  }
}

export async function waitForInkEncodes(
  isEncoding: (rasterId: string) => boolean,
  rasterIds: readonly string[],
  clock: EncodeWaitClock = {},
): Promise<void> {
  const unique = [...new Set(rasterIds)];
  await Promise.all(unique.map((rasterId) => waitUntilNotEncoding(() => isEncoding(rasterId), clock)));
}
