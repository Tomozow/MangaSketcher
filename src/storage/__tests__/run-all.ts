import assert from 'node:assert/strict';
import { test, describe, beforeEach, afterEach, mock } from 'node:test';

(globalThis as { describe: typeof describe }).describe = describe;
(globalThis as { test: typeof test }).test = test;
(globalThis as { beforeEach: typeof beforeEach }).beforeEach = beforeEach;
(globalThis as { afterEach: typeof afterEach }).afterEach = afterEach;
(globalThis as { expect: (value: unknown) => unknown }).expect = (value: unknown) => ({
  toBe(expected: unknown) {
    assert.equal(value, expected);
  },
  toEqual(expected: unknown) {
    assert.deepEqual(value, expected);
  },
  toHaveLength(expected: number) {
    assert.equal((value as { length: number }).length, expected);
  },
  toBeDefined() {
    assert.notEqual(value, undefined);
  },
  toBeUndefined() {
    assert.equal(value, undefined);
  },
  toBeNull() {
    assert.equal(value, null);
  },
  toBeGreaterThan(expected: number) {
    assert.ok((value as number) > expected);
  },
  not: {
    toBeNull() {
      assert.notEqual(value, null);
    },
  },
  rejects: {
    async toThrow() {
      await assert.rejects(async () => {
        await (value as Promise<unknown>);
      });
    },
  },
});

const jestShim = {
  useFakeTimers() {
    // no-op for node:test runs
  },
  useRealTimers() {
    // no-op
  },
  advanceTimersByTime(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

(globalThis as { jest: typeof jestShim }).jest = jestShim;

async function main() {
  await import('./projectStore.test.ts');
  await import('./autosave.test.ts');
  await import('./history.test.ts');
  await import('./editorBoot.test.ts');
}

void main();
