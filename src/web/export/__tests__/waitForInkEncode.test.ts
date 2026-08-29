import { describe, expect, test } from 'vitest';
import { WorkspaceExportError } from '../errors';
import { waitUntilNotEncoding } from '../waitForInkEncode';

describe('waitUntilNotEncoding', () => {
  test('returns immediately when not encoding', async () => {
    let slept = 0;
    await waitUntilNotEncoding(() => false, {
      sleep: async () => {
        slept += 1;
      },
    });
    expect(slept).toBe(0);
  });

  test('times out at 15s bound and fails the export', async () => {
    let now = 0;
    await expect(
      waitUntilNotEncoding(() => true, {
        timeoutMs: 15_000,
        pollMs: 50,
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
    expect(now).toBeGreaterThanOrEqual(15_000);
  });
});
