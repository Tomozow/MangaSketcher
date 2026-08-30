import { afterEach, describe, expect, test, vi } from 'vitest';
import { requestPersistentStorage, resetPersistentStorageGate } from '../persistentStorage';

afterEach(() => {
  resetPersistentStorageGate();
  vi.unstubAllGlobals();
});

describe('requestPersistentStorage', () => {
  test('calls persist once even when invoked twice', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persist } });

    await requestPersistentStorage();
    await requestPersistentStorage();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  test('swallows persist rejection', async () => {
    const persist = vi.fn(async () => {
      throw new Error('denied');
    });
    vi.stubGlobal('navigator', { storage: { persist } });

    await expect(requestPersistentStorage()).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
