import { publicUrl } from '@/src/web/publicUrl';

export const SHELL_UPDATE_SESSION_KEY = 'ms-shell-update';
export const SHELL_PROBE_PATH = publicUrl('/sw.js');
export const SHELL_PROBE_TIMEOUT_MS = 2500;

export type ShellUpdateStatus = 'idle' | 'checking' | 'current' | 'offline' | 'updated';

export type PersistedShellUpdateStatus = Exclude<ShellUpdateStatus, 'idle' | 'checking'>;

export type ShellWorkerLike = {
  state: string;
  postMessage: (message: unknown) => void;
  addEventListener: (type: 'statechange', listener: () => void) => void;
};

export type ShellRegistrationLike = {
  installing: ShellWorkerLike | null;
  waiting: ShellWorkerLike | null;
  update: () => Promise<unknown>;
};

export type ShellStartupHost = {
  getRegistration: () => Promise<ShellRegistrationLike | undefined>;
  register: () => Promise<unknown>;
  probe: () => Promise<'ok' | 'timeout' | 'error'>;
  readSession: () => PersistedShellUpdateStatus | null;
  writeSession: (status: PersistedShellUpdateStatus) => void;
  reload: () => void;
  setStatus: (status: ShellUpdateStatus) => void;
  updateTimeoutMs?: number;
};

type SessionRecord = { status: PersistedShellUpdateStatus };

let currentStatus: ShellUpdateStatus = 'idle';
const listeners = new Set<(status: ShellUpdateStatus) => void>();

export function getShellUpdateStatus(): ShellUpdateStatus {
  return currentStatus;
}

export function setShellUpdateStatus(status: ShellUpdateStatus): void {
  currentStatus = status;
  for (const listener of listeners) {
    listener(status);
  }
}

export function subscribeShellUpdateStatus(listener: (status: ShellUpdateStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function shellUpdateStatusLabel(status: ShellUpdateStatus): string | null {
  switch (status) {
    case 'checking':
      return '更新を確認しています…';
    case 'current':
      return '最新です';
    case 'offline':
      return 'サーバー未接続 · 端末内で動作中';
    case 'updated':
      return '更新を適用しています…';
    default:
      return null;
  }
}

export function readShellUpdateSession(storage: Pick<Storage, 'getItem'>): PersistedShellUpdateStatus | null {
  try {
    const raw = storage.getItem(SHELL_UPDATE_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SessionRecord;
    if (parsed.status === 'current' || parsed.status === 'offline' || parsed.status === 'updated') {
      return parsed.status;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeShellUpdateSession(
  storage: Pick<Storage, 'setItem'>,
  status: PersistedShellUpdateStatus,
): void {
  storage.setItem(SHELL_UPDATE_SESSION_KEY, JSON.stringify({ status } satisfies SessionRecord));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = timers.setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      timers.clearTimeout(timer);
    }
  }
}

export async function probeShellServer(
  fetchFn: typeof fetch,
  timeoutMs: number,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): Promise<'ok' | 'timeout' | 'error'> {
  const controller = new AbortController();
  const timer = timers.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(SHELL_PROBE_PATH, {
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok ? 'ok' : 'error';
  } catch {
    return controller.signal.aborted ? 'timeout' : 'error';
  } finally {
    timers.clearTimeout(timer);
  }
}

export function restoreShellUpdateSession(storage: Pick<Storage, 'getItem'>): boolean {
  const session = readShellUpdateSession(storage);
  if (!session) {
    return false;
  }
  setShellUpdateStatus(session === 'updated' ? 'current' : session);
  return true;
}

export async function runShellStartup(host: ShellStartupHost): Promise<void> {
  const session = host.readSession();
  const existing = await host.getRegistration();
  if (!existing) {
    try {
      await host.register();
      host.writeSession('current');
      host.setStatus('current');
    } catch {
      host.setStatus('idle');
    }
    return;
  }

  if (session) {
    host.setStatus(session === 'updated' ? 'current' : session);
  } else {
    host.setStatus('checking');
  }

  const probe = await host.probe();
  if (probe !== 'ok') {
    if (!session) {
      host.writeSession('offline');
      host.setStatus('offline');
    }
    return;
  }

  try {
    await withTimeout(existing.update(), host.updateTimeoutMs ?? SHELL_PROBE_TIMEOUT_MS);
  } catch {
    if (!session) {
      host.writeSession('offline');
      host.setStatus('offline');
    }
    return;
  }

  if (existing.waiting || existing.installing) {
    existing.waiting?.postMessage({ type: 'SKIP_WAITING' });
    host.setStatus('updated');
    host.writeSession('current');
    host.reload();
    return;
  }

  if (!session) {
    host.writeSession('current');
    host.setStatus('current');
  }
}
