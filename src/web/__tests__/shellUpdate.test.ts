import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  SHELL_PROBE_PATH,
  SHELL_UPDATE_SESSION_KEY,
  getShellUpdateStatus,
  probeShellServer,
  readShellUpdateSession,
  restoreShellUpdateSession,
  runShellStartup,
  setShellUpdateStatus,
  shellUpdateStatusLabel,
  subscribeShellUpdateStatus,
  writeShellUpdateSession,
  type ShellRegistrationLike,
  type ShellStartupHost,
} from '../shellUpdate';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function host(overrides: Partial<ShellStartupHost> & Pick<ShellStartupHost, 'getRegistration'>): ShellStartupHost {
  return {
    register: vi.fn(async () => undefined),
    probe: vi.fn(async () => 'ok' as const),
    readSession: () => null,
    writeSession: vi.fn(),
    reload: vi.fn(),
    setStatus: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  setShellUpdateStatus('idle');
});

describe('shellUpdateStatusLabel', () => {
  test('maps each phase for the list screen', () => {
    expect(shellUpdateStatusLabel('idle')).toBeNull();
    expect(shellUpdateStatusLabel('checking')).toBe('更新を確認しています…');
    expect(shellUpdateStatusLabel('current')).toBe('最新です');
    expect(shellUpdateStatusLabel('offline')).toBe('サーバー未接続 · 端末内で動作中');
    expect(shellUpdateStatusLabel('updated')).toBe('更新を適用しています…');
  });
});

describe('session restore', () => {
  test('restores a finished check and skips another probe', async () => {
    const storage = memoryStorage();
    writeShellUpdateSession(storage, 'offline');
    expect(readShellUpdateSession(storage)).toBe('offline');
    expect(restoreShellUpdateSession(storage)).toBe(true);
    expect(getShellUpdateStatus()).toBe('offline');

    const startup = host({
      getRegistration: vi.fn(async () => ({
        installing: null,
        waiting: null,
        update: vi.fn(),
      })),
      readSession: () => readShellUpdateSession(storage),
    });
    await runShellStartup(startup);
    expect(startup.probe).not.toHaveBeenCalled();
    expect(startup.register).not.toHaveBeenCalled();
    expect(startup.setStatus).toHaveBeenCalledWith('offline');
  });

  test('maps a leftover updated session to current after reload', () => {
    const storage = memoryStorage({
      [SHELL_UPDATE_SESSION_KEY]: JSON.stringify({ status: 'updated' }),
    });
    expect(restoreShellUpdateSession(storage)).toBe(true);
    expect(getShellUpdateStatus()).toBe('current');
  });
});

describe('probeShellServer', () => {
  test('returns ok when sw.js is reachable', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }));
    await expect(probeShellServer(fetchFn, 50)).resolves.toBe('ok');
    expect(fetchFn).toHaveBeenCalledWith(
      SHELL_PROBE_PATH,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  test('times out instead of waiting for a hung LAN fetch', async () => {
    const fetchFn = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    await expect(probeShellServer(fetchFn, 20)).resolves.toBe('timeout');
  });
});

describe('runShellStartup', () => {
  test('registers once when the shell is not on the device yet', async () => {
    const startup = host({
      getRegistration: vi.fn(async () => undefined),
    });
    await runShellStartup(startup);
    expect(startup.register).toHaveBeenCalledTimes(1);
    expect(startup.probe).not.toHaveBeenCalled();
    expect(startup.writeSession).toHaveBeenCalledWith('current');
    expect(startup.setStatus).toHaveBeenCalledWith('current');
  });

  test('does not register or update when the probe cannot reach the server', async () => {
    const registration: ShellRegistrationLike = {
      installing: null,
      waiting: null,
      update: vi.fn(async () => undefined),
    };
    const startup = host({
      getRegistration: vi.fn(async () => registration),
      probe: vi.fn(async () => 'timeout' as const),
    });
    await runShellStartup(startup);
    expect(startup.setStatus).toHaveBeenCalledWith('checking');
    expect(startup.setStatus).toHaveBeenCalledWith('offline');
    expect(startup.writeSession).toHaveBeenCalledWith('offline');
    expect(registration.update).not.toHaveBeenCalled();
    expect(startup.register).not.toHaveBeenCalled();
    expect(startup.reload).not.toHaveBeenCalled();
  });

  test('marks current and does not reload when the server has no new worker', async () => {
    const registration: ShellRegistrationLike = {
      installing: null,
      waiting: null,
      update: vi.fn(async () => undefined),
    };
    const startup = host({
      getRegistration: vi.fn(async () => registration),
    });
    await runShellStartup(startup);
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(startup.writeSession).toHaveBeenCalledWith('current');
    expect(startup.setStatus).toHaveBeenCalledWith('current');
    expect(startup.reload).not.toHaveBeenCalled();
  });

  test('marks offline when update hangs past the timeout', async () => {
    const registration: ShellRegistrationLike = {
      installing: null,
      waiting: null,
      update: vi.fn(() => new Promise(() => {})),
    };
    const startup = host({
      getRegistration: vi.fn(async () => registration),
      updateTimeoutMs: 20,
    });
    await runShellStartup(startup);
    expect(startup.writeSession).toHaveBeenCalledWith('offline');
    expect(startup.setStatus).toHaveBeenCalledWith('offline');
    expect(startup.reload).not.toHaveBeenCalled();
  });

  test('reloads once when a waiting worker is ready', async () => {
    const waiting = { state: 'installed', postMessage: vi.fn(), addEventListener: vi.fn() };
    const registration: ShellRegistrationLike = {
      installing: null,
      waiting,
      update: vi.fn(async () => undefined),
    };
    const startup = host({
      getRegistration: vi.fn(async () => registration),
    });
    await runShellStartup(startup);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(startup.setStatus).toHaveBeenCalledWith('updated');
    expect(startup.writeSession).toHaveBeenCalledWith('current');
    expect(startup.reload).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeShellUpdateStatus', () => {
  test('notifies listeners and unsubscribes', () => {
    const listener = vi.fn();
    const stop = subscribeShellUpdateStatus(listener);
    setShellUpdateStatus('checking');
    expect(listener).toHaveBeenCalledWith('checking');
    stop();
    setShellUpdateStatus('current');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
