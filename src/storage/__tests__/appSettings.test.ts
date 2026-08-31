import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  DEFAULT_SHORTCUTS,
  assignShortcut,
  delaysForAutosavePreset,
  getAutosaveDelays,
  getHistoryDepth,
  hydrateAppSettings,
  loadAppSettings,
  parseAppSettings,
  resetAppSettingsRuntimeState,
  saveAppSettings,
  shortcutLabelFromCode,
} from '../appSettings';
import { setDefaultStorageDatabase } from '../idb';
import { listProjects } from '../projectStore';
import { MemoryStorageDatabase } from '../testUtils/memoryDb';
import { APP_SETTINGS_META_ID, DOCUMENT_SAVE_DEBOUNCE_MS, VIEW_ONLY_SAVE_DEBOUNCE_MS, type ProjectMeta } from '../types';

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
  resetAppSettingsRuntimeState();
  setDefaultStorageDatabase(null);
  vi.unstubAllGlobals();
});

describe('appSettings', () => {
  test('未知のプリセットや壊れた JSON は短めに戻す', () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
    expect(parseAppSettings({ autosavePreset: 'nope' }).autosaveMs).toBe(DOCUMENT_SAVE_DEBOUNCE_MS);
    expect(parseAppSettings({ autosavePreset: 'slow' }).autosaveMs).toBe(8000);
    expect(delaysForAutosavePreset('fast')).toEqual({
      documentMs: DOCUMENT_SAVE_DEBOUNCE_MS,
      viewOnlyMs: VIEW_ONLY_SAVE_DEBOUNCE_MS,
    });
    expect(delaysForAutosavePreset('long').documentMs).toBe(20000);
  });

  test('スライダー値と旧プリセットを読み戻す', () => {
    installMemoryStorage();
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    saveAppSettings({ autosaveMs: 8000, inkIdleMs: 2500, historyDepth: 20 });
    const stored = JSON.parse(memory.get(APP_SETTINGS_STORAGE_KEY)!) as Record<string, unknown>;
    expect(stored.autosaveMs).toBe(8000);
    expect(stored.inkIdleMs).toBe(2500);
    expect(stored.historyDepth).toBe(20);
    expect(loadAppSettings().autosaveMs).toBe(8000);
    expect(getAutosaveDelays().documentMs).toBe(8000);
    expect(getHistoryDepth()).toBe(20);
  });

  test('ナビ・配置反転・ページ送りの真偽と単位を正規化する', () => {
    expect(parseAppSettings({ navBarVisible: false, chromeFlip: true, pageTurnUnit: 'spread' })).toMatchObject({
      navBarVisible: false,
      chromeFlip: true,
      pageTurnUnit: 'spread',
    });
    expect(parseAppSettings({ toolFlyoutOnFirstTap: true }).toolFlyoutOnFirstTap).toBe(true);
    expect(parseAppSettings({}).toolFlyoutOnFirstTap).toBe(false);
    expect(parseAppSettings({ pageTurnUnit: 'nope' }).pageTurnUnit).toBe('page');
    expect(parseAppSettings({ historyDepth: 999 }).historyDepth).toBe(200);
    expect(parseAppSettings({ inkIdleMs: 10 }).inkIdleMs).toBe(200);
  });

  test('ショートカットの割当は衝突すると入れ替える', () => {
    const swapped = assignShortcut(DEFAULT_SHORTCUTS, 'pen', 'KeyE');
    expect(swapped.pen).toBe('KeyE');
    expect(swapped.eraser).toBe('KeyB');
    expect(shortcutLabelFromCode('KeyB')).toBe('B');
    expect(parseAppSettings({ shortcuts: { pen: 'Space' } }).shortcuts.pen).toBe('KeyB');
  });

  test('localStorage が空でも IndexedDB から復帰し、作品一覧には出さない', async () => {
    installMemoryStorage();
    vi.stubGlobal('indexedDB', {});
    const db = new MemoryStorageDatabase();
    setDefaultStorageDatabase(db);
    await db.putMeta({
      id: APP_SETTINGS_META_ID,
      name: '',
      updatedAt: '2026-01-01T00:00:00.000Z',
      pageCount: 0,
      settings: parseAppSettings({ autosaveMs: 5000, chromeFlip: true, pageTurnUnit: 'spread' }),
    } as ProjectMeta);
    const restored = await hydrateAppSettings();
    expect(restored.autosaveMs).toBe(5000);
    expect(restored.chromeFlip).toBe(true);
    expect(loadAppSettings().pageTurnUnit).toBe('spread');
    expect(await listProjects({ db })).toEqual([]);
  });
});
