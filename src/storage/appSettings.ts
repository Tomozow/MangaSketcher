import { getDefaultStorageDatabase } from './idb';
import {
  APP_SETTINGS_META_ID,
  DOCUMENT_SAVE_DEBOUNCE_MS,
  HISTORY_DEPTH,
  INK_IDLE_AUTOSAVE_MS,
  VIEW_ONLY_SAVE_DEBOUNCE_MS,
  type ProjectMeta,
} from './types';

export const APP_SETTINGS_STORAGE_KEY = 'mangasketcher:app-settings';
export const APP_SETTINGS_CHANGED_EVENT = 'mangasketcher:app-settings-changed';

export const AUTOSAVE_PRESET_IDS = ['fast', 'standard', 'slow', 'long'] as const;
export type AutosavePresetId = (typeof AUTOSAVE_PRESET_IDS)[number];

export const SHORTCUT_ACTION_IDS = ['pen', 'eraser', 'text', 'select', 'undo', 'redo'] as const;
export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];
export type ShortcutMap = Record<ShortcutActionId, string>;

export const PAGE_TURN_UNITS = ['page', 'spread'] as const;
export type PageTurnUnit = (typeof PAGE_TURN_UNITS)[number];

export const INK_IDLE_MS_MIN = 200;
export const INK_IDLE_MS_MAX = 10_000;
export const AUTOSAVE_MS_MIN = 500;
export const AUTOSAVE_MS_MAX = 30_000;
export const HISTORY_DEPTH_MIN = 10;
export const HISTORY_DEPTH_MAX = 200;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  pen: 'KeyB',
  eraser: 'KeyE',
  text: 'KeyT',
  select: 'KeyC',
  undo: 'KeyW',
  redo: 'KeyS',
};

export const SHORTCUT_ACTION_LABELS: Record<ShortcutActionId, string> = {
  pen: 'ペン',
  eraser: '消しゴム',
  text: 'テキスト',
  select: '選択',
  undo: '取り消し',
  redo: 'やり直し',
};

export type AppSettings = {
  autosavePreset: AutosavePresetId;
  autosaveMs: number;
  inkIdleMs: number;
  historyDepth: number;
  navBarVisible: boolean;
  chromeFlip: boolean;
  pageTurnUnit: PageTurnUnit;
  toolFlyoutOnFirstTap: boolean;
  shortcuts: ShortcutMap;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autosavePreset: 'fast',
  autosaveMs: DOCUMENT_SAVE_DEBOUNCE_MS,
  inkIdleMs: INK_IDLE_AUTOSAVE_MS,
  historyDepth: HISTORY_DEPTH,
  navBarVisible: true,
  chromeFlip: false,
  pageTurnUnit: 'page',
  toolFlyoutOnFirstTap: false,
  shortcuts: { ...DEFAULT_SHORTCUTS },
};

export const AUTOSAVE_PRESET_OPTIONS: ReadonlyArray<{
  id: AutosavePresetId;
  label: string;
  documentMs: number;
  viewOnlyMs: number;
}> = [
  {
    id: 'fast',
    label: '短め（0.8秒）',
    documentMs: DOCUMENT_SAVE_DEBOUNCE_MS,
    viewOnlyMs: VIEW_ONLY_SAVE_DEBOUNCE_MS,
  },
  { id: 'standard', label: '標準（3秒）', documentMs: 3000, viewOnlyMs: 4000 },
  { id: 'slow', label: '長め（8秒）', documentMs: 8000, viewOnlyMs: 10000 },
  { id: 'long', label: '最長（20秒）', documentMs: 20000, viewOnlyMs: 25000 },
];

const PRESET_BY_ID = new Map(AUTOSAVE_PRESET_OPTIONS.map((preset) => [preset.id, preset]));

const ASSIGNABLE_SHORTCUT_CODE =
  /^(Key[A-Z]|Digit[0-9]|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;

export function isAutosavePresetId(value: unknown): value is AutosavePresetId {
  return typeof value === 'string' && PRESET_BY_ID.has(value as AutosavePresetId);
}

export function isPageTurnUnit(value: unknown): value is PageTurnUnit {
  return value === 'page' || value === 'spread';
}

export function isShortcutActionId(value: unknown): value is ShortcutActionId {
  return typeof value === 'string' && (SHORTCUT_ACTION_IDS as readonly string[]).includes(value);
}

export function isAssignableShortcutCode(value: unknown): value is string {
  return typeof value === 'string' && ASSIGNABLE_SHORTCUT_CODE.test(value);
}

export function delaysForAutosavePreset(preset: AutosavePresetId): { documentMs: number; viewOnlyMs: number } {
  const option = PRESET_BY_ID.get(preset) ?? PRESET_BY_ID.get('fast')!;
  return { documentMs: option.documentMs, viewOnlyMs: option.viewOnlyMs };
}

export function clampInkIdleMs(value: unknown): number {
  return clampInt(value, INK_IDLE_MS_MIN, INK_IDLE_MS_MAX, DEFAULT_APP_SETTINGS.inkIdleMs);
}

export function clampAutosaveMs(value: unknown): number {
  return clampInt(value, AUTOSAVE_MS_MIN, AUTOSAVE_MS_MAX, DEFAULT_APP_SETTINGS.autosaveMs);
}

export function clampHistoryDepth(value: unknown): number {
  return clampInt(value, HISTORY_DEPTH_MIN, HISTORY_DEPTH_MAX, DEFAULT_APP_SETTINGS.historyDepth);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function parseShortcuts(raw: unknown): ShortcutMap {
  const next = { ...DEFAULT_SHORTCUTS };
  if (!raw || typeof raw !== 'object') {
    return next;
  }
  const record = raw as Record<string, unknown>;
  for (const action of SHORTCUT_ACTION_IDS) {
    const code = record[action];
    if (isAssignableShortcutCode(code)) {
      next[action] = code;
    }
  }
  return uniquifyShortcuts(next);
}

function uniquifyShortcuts(map: ShortcutMap): ShortcutMap {
  const used = new Set<string>();
  const next = { ...map };
  for (const action of SHORTCUT_ACTION_IDS) {
    const code = next[action];
    if (!used.has(code)) {
      used.add(code);
      continue;
    }
    const fallback = DEFAULT_SHORTCUTS[action];
    if (!used.has(fallback)) {
      next[action] = fallback;
      used.add(fallback);
      continue;
    }
    for (const candidate of Object.values(DEFAULT_SHORTCUTS)) {
      if (!used.has(candidate)) {
        next[action] = candidate;
        used.add(candidate);
        break;
      }
    }
  }
  return next;
}

export function assignShortcut(map: ShortcutMap, action: ShortcutActionId, code: string): ShortcutMap {
  if (!isAssignableShortcutCode(code)) {
    return { ...map };
  }
  const next = { ...map };
  const displaced = SHORTCUT_ACTION_IDS.find((id) => id !== action && next[id] === code);
  const previous = next[action];
  next[action] = code;
  if (displaced) {
    next[displaced] = previous;
  }
  return uniquifyShortcuts(next);
}

export function shortcutLabelFromCode(code: string): string {
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3);
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5);
  }
  const named: Record<string, string> = {
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  return named[code] ?? code;
}

function nearestAutosavePreset(autosaveMs: number): AutosavePresetId {
  let best: AutosavePresetId = 'fast';
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const option of AUTOSAVE_PRESET_OPTIONS) {
    const delta = Math.abs(option.documentMs - autosaveMs);
    if (delta < bestDelta) {
      best = option.id;
      bestDelta = delta;
    }
  }
  return best;
}

export function parseAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_APP_SETTINGS, shortcuts: { ...DEFAULT_SHORTCUTS } };
  }
  const record = raw as {
    autosavePreset?: unknown;
    autosaveMs?: unknown;
    inkIdleMs?: unknown;
    historyDepth?: unknown;
    navBarVisible?: unknown;
    chromeFlip?: unknown;
    pageTurnUnit?: unknown;
    toolFlyoutOnFirstTap?: unknown;
    shortcuts?: unknown;
  };
  const preset = isAutosavePresetId(record.autosavePreset) ? record.autosavePreset : null;
  const autosaveMs =
    record.autosaveMs != null
      ? clampAutosaveMs(record.autosaveMs)
      : preset
        ? delaysForAutosavePreset(preset).documentMs
        : DEFAULT_APP_SETTINGS.autosaveMs;
  return {
    autosavePreset: nearestAutosavePreset(autosaveMs),
    autosaveMs,
    inkIdleMs: clampInkIdleMs(record.inkIdleMs),
    historyDepth: clampHistoryDepth(record.historyDepth),
    navBarVisible: record.navBarVisible !== false,
    chromeFlip: record.chromeFlip === true,
    pageTurnUnit: isPageTurnUnit(record.pageTurnUnit) ? record.pageTurnUnit : DEFAULT_APP_SETTINGS.pageTurnUnit,
    toolFlyoutOnFirstTap: record.toolFlyoutOnFirstTap === true,
    shortcuts: parseShortcuts(record.shortcuts),
  };
}

type AppSettingsMeta = ProjectMeta & { settings: AppSettings };

let snapshot: AppSettings | null = null;
let writesThisSession = 0;
let hydrateStarted = false;

function cloneSettings(value: AppSettings): AppSettings {
  return parseAppSettings(value);
}

function readLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function readFromLocalStorage(): AppSettings | null {
  const storage = readLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return parseAppSettings(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeLocalStorage(next: AppSettings): void {
  const storage = readLocalStorage();
  try {
    storage?.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: IndexedDB + in-memory snapshot still keep the choice.
  }
}

function emitSettingsChanged(next: AppSettings): void {
  try {
    if (typeof window === 'undefined') {
      return;
    }
    window.dispatchEvent(new CustomEvent(APP_SETTINGS_CHANGED_EVENT, { detail: next }));
  } catch {
    // Node / tests without EventTarget.
  }
}

function settingsFromMeta(meta: ProjectMeta | undefined): AppSettings | null {
  if (!meta || typeof meta !== 'object' || !('settings' in meta)) {
    return null;
  }
  return parseAppSettings((meta as AppSettingsMeta).settings);
}

async function writeSettingsToIdb(next: AppSettings): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  const record: AppSettingsMeta = {
    id: APP_SETTINGS_META_ID,
    name: '',
    updatedAt: new Date().toISOString(),
    pageCount: 0,
    settings: cloneSettings(next),
  };
  await getDefaultStorageDatabase().putMeta(record);
}

async function readSettingsFromIdb(): Promise<AppSettings | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  try {
    return settingsFromMeta(await getDefaultStorageDatabase().getMeta(APP_SETTINGS_META_ID));
  } catch {
    return null;
  }
}

function commitSnapshot(next: AppSettings, persistIdb: boolean): AppSettings {
  snapshot = next;
  writeLocalStorage(next);
  if (persistIdb) {
    void writeSettingsToIdb(next).catch(() => {});
  }
  emitSettingsChanged(next);
  return next;
}

export function getAppSettingsSnapshot(): AppSettings {
  if (!snapshot) {
    snapshot = readFromLocalStorage() ?? cloneSettings(DEFAULT_APP_SETTINGS);
  }
  return snapshot;
}

export function getAppSettingsServerSnapshot(): AppSettings {
  return DEFAULT_APP_SETTINGS;
}

export function loadAppSettings(): AppSettings {
  return getAppSettingsSnapshot();
}

export function subscribeAppSettings(onStoreChange: () => void): () => void {
  void hydrateAppSettings();
  const onChanged = () => onStoreChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APP_SETTINGS_STORAGE_KEY && event.key != null) {
      return;
    }
    snapshot = readFromLocalStorage() ?? cloneSettings(DEFAULT_APP_SETTINGS);
    onStoreChange();
  };
  window.addEventListener(APP_SETTINGS_CHANGED_EVENT, onChanged);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(APP_SETTINGS_CHANGED_EVENT, onChanged);
    window.removeEventListener('storage', onStorage);
  };
}

/** Restore settings from IndexedDB when localStorage was empty or wiped. */
export async function hydrateAppSettings(): Promise<AppSettings> {
  if (hydrateStarted) {
    return getAppSettingsSnapshot();
  }
  hydrateStarted = true;
  const fromLs = readFromLocalStorage();
  const fromIdb = await readSettingsFromIdb();
  if (writesThisSession > 0) {
    return getAppSettingsSnapshot();
  }
  if (fromLs) {
    snapshot = fromLs;
    void writeSettingsToIdb(fromLs).catch(() => {});
    return fromLs;
  }
  if (fromIdb) {
    snapshot = fromIdb;
    writeLocalStorage(fromIdb);
    emitSettingsChanged(fromIdb);
    return fromIdb;
  }
  return getAppSettingsSnapshot();
}

export function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  writesThisSession += 1;
  const loaded = loadAppSettings();
  const next = parseAppSettings({
    ...loaded,
    ...patch,
    shortcuts: patch.shortcuts ? { ...loaded.shortcuts, ...patch.shortcuts } : loaded.shortcuts,
  });
  return commitSnapshot(next, true);
}

export function resetAppSettingsRuntimeState(): void {
  snapshot = null;
  writesThisSession = 0;
  hydrateStarted = false;
}

export function getAutosaveDelays(): { documentMs: number; viewOnlyMs: number } {
  const settings = loadAppSettings();
  return {
    documentMs: settings.autosaveMs,
    viewOnlyMs: Math.max(settings.autosaveMs, Math.round(settings.autosaveMs * 1.25)),
  };
}

export function getHistoryDepth(): number {
  return loadAppSettings().historyDepth;
}

export function getInkIdleMs(): number {
  return loadAppSettings().inkIdleMs;
}
