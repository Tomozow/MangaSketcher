import { DOCUMENT_SAVE_DEBOUNCE_MS, VIEW_ONLY_SAVE_DEBOUNCE_MS } from './types';

export const APP_SETTINGS_STORAGE_KEY = 'mangasketcher:app-settings';

export const AUTOSAVE_PRESET_IDS = ['fast', 'standard', 'slow', 'long'] as const;
export type AutosavePresetId = (typeof AUTOSAVE_PRESET_IDS)[number];

export type AppSettings = {
  autosavePreset: AutosavePresetId;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autosavePreset: 'fast',
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

export function isAutosavePresetId(value: unknown): value is AutosavePresetId {
  return typeof value === 'string' && PRESET_BY_ID.has(value as AutosavePresetId);
}

export function delaysForAutosavePreset(preset: AutosavePresetId): { documentMs: number; viewOnlyMs: number } {
  const option = PRESET_BY_ID.get(preset) ?? PRESET_BY_ID.get('fast')!;
  return { documentMs: option.documentMs, viewOnlyMs: option.viewOnlyMs };
}

export function parseAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_APP_SETTINGS };
  }
  const preset = (raw as { autosavePreset?: unknown }).autosavePreset;
  return {
    autosavePreset: isAutosavePresetId(preset) ? preset : DEFAULT_APP_SETTINGS.autosavePreset,
  };
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

export function loadAppSettings(): AppSettings {
  const storage = readLocalStorage();
  if (!storage) {
    return { ...DEFAULT_APP_SETTINGS };
  }
  try {
    const raw = storage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_APP_SETTINGS };
    }
    return parseAppSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadAppSettings(), ...patch };
  if (!isAutosavePresetId(next.autosavePreset)) {
    next.autosavePreset = DEFAULT_APP_SETTINGS.autosavePreset;
  }
  const storage = readLocalStorage();
  try {
    storage?.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: keep the in-memory choice for this page only.
  }
  return next;
}

export function getAutosaveDelays(): { documentMs: number; viewOnlyMs: number } {
  return delaysForAutosavePreset(loadAppSettings().autosavePreset);
}
