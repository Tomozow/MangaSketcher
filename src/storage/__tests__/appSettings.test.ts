import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  delaysForAutosavePreset,
  getAutosaveDelays,
  loadAppSettings,
  parseAppSettings,
  saveAppSettings,
} from '../appSettings';
import { DOCUMENT_SAVE_DEBOUNCE_MS, VIEW_ONLY_SAVE_DEBOUNCE_MS } from '../types';

const memory = new Map<string, string>();

function installMemoryStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => {
      memory.clear();
    },
    key: () => null,
    length: 0,
  });
}

afterEach(() => {
  memory.clear();
  vi.unstubAllGlobals();
});

describe('appSettings', () => {
  test('未知のプリセットや壊れた JSON は短めに戻す', () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings({ autosavePreset: 'nope' })).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings({ autosavePreset: 'slow' })).toEqual({ autosavePreset: 'slow' });
    expect(delaysForAutosavePreset('fast')).toEqual({
      documentMs: DOCUMENT_SAVE_DEBOUNCE_MS,
      viewOnlyMs: VIEW_ONLY_SAVE_DEBOUNCE_MS,
    });
    expect(delaysForAutosavePreset('long').documentMs).toBe(20000);
  });

  test('localStorage に保存して読み戻す', () => {
    installMemoryStorage();
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    saveAppSettings({ autosavePreset: 'slow' });
    expect(JSON.parse(memory.get(APP_SETTINGS_STORAGE_KEY)!)).toEqual({ autosavePreset: 'slow' });
    expect(loadAppSettings()).toEqual({ autosavePreset: 'slow' });
    expect(getAutosaveDelays().documentMs).toBe(8000);
  });
});
