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

export const PEN_SIZE_PRESET_COUNT = 4;
export const PEN_SIZE_MIN = 1;
export const PEN_SIZE_MAX = 64;
export type PenSizePresets = [number, number, number, number];
export type BoolPresets = [boolean, boolean, boolean, boolean];

export const DEFAULT_PEN_SIZE_PRESETS: PenSizePresets = [4, 8, 12, 24];
export const DEFAULT_PEN_OPACITY_PRESETS: PenSizePresets = [1, 1, 1, 1];
export const DEFAULT_PEN_SIZE_PRESET_INDEX = 2;
export const DEFAULT_PRESSURE_SIZE_PRESETS: BoolPresets = [true, true, true, true];
export const DEFAULT_PRESSURE_OPACITY_PRESETS: BoolPresets = [false, false, false, false];
export const PEN_OPACITY_MIN = 0.05;
export const PEN_OPACITY_MAX = 1;
export const ERASER_SIZE_MIN = 1;
export const ERASER_SIZE_MAX = 128;
export const DEFAULT_ERASER_SIZE_PRESETS: PenSizePresets = [12, 28, 48, 80];
export const DEFAULT_ERASER_SIZE_PRESET_INDEX = 1;

export type AppSettings = {
  autosavePreset: AutosavePresetId;
  autosaveMs: number;
  inkIdleMs: number;
  historyDepth: number;
  navBarVisible: boolean;
  chromeFlip: boolean;
  pageTurnUnit: PageTurnUnit;
  toolFlyoutOnFirstTap: boolean;
  stockRevealOnBottomEdge: boolean;
  stockHideAfterEdgeDrop: boolean;
  penSizePresets: PenSizePresets;
  penOpacityPresets: PenSizePresets;
  penSizePresetIndex: number;
  penPressureSize: BoolPresets;
  penPressureOpacity: BoolPresets;
  eraserSizePresets: PenSizePresets;
  eraserOpacityPresets: PenSizePresets;
  eraserSizePresetIndex: number;
  eraserPressureSize: BoolPresets;
  eraserPressureOpacity: BoolPresets;
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
  stockRevealOnBottomEdge: false,
  stockHideAfterEdgeDrop: false,
  penSizePresets: [...DEFAULT_PEN_SIZE_PRESETS],
  penOpacityPresets: [...DEFAULT_PEN_OPACITY_PRESETS],
  penSizePresetIndex: DEFAULT_PEN_SIZE_PRESET_INDEX,
  penPressureSize: [...DEFAULT_PRESSURE_SIZE_PRESETS],
  penPressureOpacity: [...DEFAULT_PRESSURE_OPACITY_PRESETS],
  eraserSizePresets: [...DEFAULT_ERASER_SIZE_PRESETS],
  eraserOpacityPresets: [...DEFAULT_PEN_OPACITY_PRESETS],
  eraserSizePresetIndex: DEFAULT_ERASER_SIZE_PRESET_INDEX,
  eraserPressureSize: [...DEFAULT_PRESSURE_SIZE_PRESETS],
  eraserPressureOpacity: [...DEFAULT_PRESSURE_OPACITY_PRESETS],
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

export function clampPenSize(value: unknown): number {
  return clampInt(value, PEN_SIZE_MIN, PEN_SIZE_MAX, DEFAULT_PEN_SIZE_PRESETS[DEFAULT_PEN_SIZE_PRESET_INDEX]);
}

export function parsePenSizePresets(raw: unknown): PenSizePresets {
  const source = Array.isArray(raw) ? raw : DEFAULT_PEN_SIZE_PRESETS;
  const next: PenSizePresets = [...DEFAULT_PEN_SIZE_PRESETS];
  for (let i = 0; i < PEN_SIZE_PRESET_COUNT; i += 1) {
    next[i] = clampPenSize(source[i] ?? DEFAULT_PEN_SIZE_PRESETS[i]);
  }
  return next;
}

export function clampPenOpacity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 1;
  }
  const stepped = Math.round(n / 0.05) * 0.05;
  return Math.min(PEN_OPACITY_MAX, Math.max(PEN_OPACITY_MIN, Number(stepped.toFixed(2))));
}

export function parsePenOpacityPresets(raw: unknown): PenSizePresets {
  const source = Array.isArray(raw) ? raw : DEFAULT_PEN_OPACITY_PRESETS;
  const next: PenSizePresets = [...DEFAULT_PEN_OPACITY_PRESETS];
  for (let i = 0; i < PEN_SIZE_PRESET_COUNT; i += 1) {
    next[i] = clampPenOpacity(source[i] ?? DEFAULT_PEN_OPACITY_PRESETS[i]);
  }
  return next;
}

export function clampEraserSize(value: unknown): number {
  return clampInt(value, ERASER_SIZE_MIN, ERASER_SIZE_MAX, DEFAULT_ERASER_SIZE_PRESETS[DEFAULT_ERASER_SIZE_PRESET_INDEX]);
}

export function parseEraserSizePresets(raw: unknown): PenSizePresets {
  const source = Array.isArray(raw) ? raw : DEFAULT_ERASER_SIZE_PRESETS;
  const next: PenSizePresets = [...DEFAULT_ERASER_SIZE_PRESETS];
  for (let i = 0; i < PEN_SIZE_PRESET_COUNT; i += 1) {
    next[i] = clampEraserSize(source[i] ?? DEFAULT_ERASER_SIZE_PRESETS[i]);
  }
  return next;
}

export function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return fallback;
}

export function parseBoolPresets(raw: unknown, fallback: BoolPresets): BoolPresets {
  if (raw === true || raw === false) {
    return [raw, raw, raw, raw];
  }
  const source = Array.isArray(raw) ? raw : fallback;
  const next: BoolPresets = [...fallback];
  for (let i = 0; i < PEN_SIZE_PRESET_COUNT; i += 1) {
    next[i] = parseBool(source[i], fallback[i]!);
  }
  return next;
}

export function parsePenSizePresetIndex(raw: unknown, fallback = DEFAULT_PEN_SIZE_PRESET_INDEX): number {
  return clampInt(raw, 0, PEN_SIZE_PRESET_COUNT - 1, fallback);
}

export function activePenSizePresetIndex(
  presets: PenSizePresets,
  penSize: number,
  fallbackIndex: number,
): number {
  const fallback = parsePenSizePresetIndex(fallbackIndex);
  if (presets[fallback] === penSize) {
    return fallback;
  }
  const found = presets.findIndex((size) => size === penSize);
  return found >= 0 ? found : fallback;
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
    stockRevealOnBottomEdge?: unknown;
    stockHideAfterEdgeDrop?: unknown;
    penSizePresets?: unknown;
    penOpacityPresets?: unknown;
    penSizePresetIndex?: unknown;
    penPressureSize?: unknown;
    penPressureOpacity?: unknown;
    eraserSizePresets?: unknown;
    eraserOpacityPresets?: unknown;
    eraserSizePresetIndex?: unknown;
    eraserPressureSize?: unknown;
    eraserPressureOpacity?: unknown;
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
    stockRevealOnBottomEdge: record.stockRevealOnBottomEdge === true,
    stockHideAfterEdgeDrop:
      record.stockRevealOnBottomEdge === true && record.stockHideAfterEdgeDrop !== false,
    penSizePresets: parsePenSizePresets(record.penSizePresets),
    penOpacityPresets: parsePenOpacityPresets(record.penOpacityPresets),
    penSizePresetIndex: parsePenSizePresetIndex(record.penSizePresetIndex),
    penPressureSize: parseBoolPresets(record.penPressureSize, DEFAULT_PRESSURE_SIZE_PRESETS),
    penPressureOpacity: parseBoolPresets(record.penPressureOpacity, DEFAULT_PRESSURE_OPACITY_PRESETS),
    eraserSizePresets: parseEraserSizePresets(record.eraserSizePresets),
    eraserOpacityPresets: parsePenOpacityPresets(record.eraserOpacityPresets),
    eraserSizePresetIndex: parsePenSizePresetIndex(record.eraserSizePresetIndex, DEFAULT_ERASER_SIZE_PRESET_INDEX),
    eraserPressureSize: parseBoolPresets(record.eraserPressureSize, DEFAULT_PRESSURE_SIZE_PRESETS),
    eraserPressureOpacity: parseBoolPresets(record.eraserPressureOpacity, DEFAULT_PRESSURE_OPACITY_PRESETS),
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
