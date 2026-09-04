import { afterEach, describe, expect, test, vi } from 'vitest';
import { LAN_PACK_FETCH_TIMEOUT_MS, probeLanPackHub } from '../client';

describe('probeLanPackHub', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('treats 204 as up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(probeLanPackHub('https://127.0.0.1:3443')).resolves.toBe(true);
  });

  test('treats 200 html as down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html></html>', { status: 200 })),
    );
    await expect(probeLanPackHub('https://127.0.0.1:3443')).resolves.toBe(false);
  });

  test('times out a hung fetch as down', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }),
    );
    const pending = probeLanPackHub('https://192.168.0.2:3443');
    await vi.advanceTimersByTimeAsync(LAN_PACK_FETCH_TIMEOUT_MS);
    await expect(pending).resolves.toBe(false);
  });
});
