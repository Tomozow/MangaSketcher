import { describe, expect, test, vi } from 'vitest';
import { navigateHomeAfterCheckpoint } from '../editorNavigate';

describe('navigateHomeAfterCheckpoint', () => {
  test('navigates only after checkpoint resolves', async () => {
    const order: string[] = [];
    let releaseCheckpoint!: () => void;
    const checkpoint = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });

    const push = vi.fn((path: string) => {
      order.push(`push:${path}`);
    });

    const navigating = navigateHomeAfterCheckpoint(async () => {
      order.push('checkpoint:start');
      await checkpoint;
      order.push('checkpoint:done');
    }, push);

    expect(order).toEqual(['checkpoint:start']);
    expect(push).not.toHaveBeenCalled();

    releaseCheckpoint();
    await navigating;

    expect(order).toEqual(['checkpoint:start', 'checkpoint:done', 'push:/']);
    expect(push).toHaveBeenCalledWith('/');
  });

  test('does not navigate when checkpoint fails', async () => {
    const push = vi.fn();
    const ok = await navigateHomeAfterCheckpoint(async () => {
      throw new Error('save failed');
    }, push);

    expect(ok).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
