import { isExportFormatId, type ExportFormatId } from './exportFormat';

export const LAST_EXPORT_FORMAT_KEY = 'mangasketcher:last-export-format';
export const DEFAULT_EXPORT_FORMAT: ExportFormatId = 'pdf';

type FormatMap = Record<string, ExportFormatId>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function readMap(storage: StorageLike): FormatMap {
  try {
    const raw = storage.getItem(LAST_EXPORT_FORMAT_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const map: FormatMap = {};
    for (const [projectId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isExportFormatId(value)) {
        map[projectId] = value;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function storageOrNull(): StorageLike | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage;
}

export function getLastExportFormat(
  projectId: string,
  storage: StorageLike | null = storageOrNull(),
): ExportFormatId {
  if (!storage) {
    return DEFAULT_EXPORT_FORMAT;
  }
  return readMap(storage)[projectId] ?? DEFAULT_EXPORT_FORMAT;
}

export function setLastExportFormat(
  projectId: string,
  format: ExportFormatId,
  storage: StorageLike | null = storageOrNull(),
): void {
  if (!storage) {
    return;
  }
  const map = readMap(storage);
  map[projectId] = format;
  storage.setItem(LAST_EXPORT_FORMAT_KEY, JSON.stringify(map));
}
