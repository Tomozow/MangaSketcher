import { describe, expect, test } from 'vitest';
import { DEFAULT_EXPORT_FORMAT, LAST_EXPORT_FORMAT_KEY, getLastExportFormat, setLastExportFormat } from '../lastExportFormat';

function memoryStorage(initial: string | null = null): Storage {
  let value = initial;
  return {
    get length() {
      return value == null ? 0 : 1;
    },
    clear() {
      value = null;
    },
    key() {
      return value == null ? null : LAST_EXPORT_FORMAT_KEY;
    },
    getItem(key: string) {
      return key === LAST_EXPORT_FORMAT_KEY ? value : null;
    },
    setItem(key: string, next: string) {
      if (key === LAST_EXPORT_FORMAT_KEY) {
        value = next;
      }
    },
    removeItem(key: string) {
      if (key === LAST_EXPORT_FORMAT_KEY) {
        value = null;
      }
    },
  };
}

describe('lastExportFormat', () => {
  test('missing or broken storage falls back to pdf', () => {
    expect(getLastExportFormat('p1', memoryStorage())).toBe(DEFAULT_EXPORT_FORMAT);
    expect(getLastExportFormat('p1', memoryStorage('{'))).toBe('pdf');
  });

  test('remembers per project and ignores unknown formats', () => {
    const storage = memoryStorage();
    setLastExportFormat('a', 'png', storage);
    setLastExportFormat('b', 'clip', storage);
    expect(getLastExportFormat('a', storage)).toBe('png');
    expect(getLastExportFormat('b', storage)).toBe('clip');
    expect(getLastExportFormat('c', storage)).toBe('pdf');
    storage.setItem(LAST_EXPORT_FORMAT_KEY, JSON.stringify({ a: 'bmp' }));
    expect(getLastExportFormat('a', storage)).toBe('pdf');
  });
});
