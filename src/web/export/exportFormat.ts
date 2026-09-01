export const EXPORT_FORMAT_IDS = ['png', 'pdf', 'clip', 'miniJpg', 'pack'] as const;
export type ExportFormatId = (typeof EXPORT_FORMAT_IDS)[number];

export const PAGE_SCOPE_MODES = ['all', 'current', 'range'] as const;
export type PageScopeMode = (typeof PAGE_SCOPE_MODES)[number];

export const EXPORT_FORMAT_LABELS: Record<ExportFormatId, string> = {
  png: 'PNG',
  pdf: 'PDF',
  clip: 'CLIP',
  miniJpg: 'ミニネーム用JPG',
  pack: 'バックアップZIP',
};

export function formatSkipsPagePicker(format: ExportFormatId): boolean {
  return format === 'pack' || format === 'miniJpg';
}

export const PAGE_SCOPE_LABELS: Record<PageScopeMode, string> = {
  all: '全ページ',
  current: 'このページ',
  range: '範囲',
};

export const EXPORT_CONFIRM_LABEL = '書き出す';
export const EXPORT_BACK_LABEL = 'もどる';
export const EXPORT_RANGE_START_LABEL = '開始';
export const EXPORT_RANGE_END_LABEL = '終了';
export const EXPORT_PAGES_DIALOG_LABEL = '書き出すページ';

export function isExportFormatId(value: unknown): value is ExportFormatId {
  return EXPORT_FORMAT_IDS.includes(value as ExportFormatId);
}

export function formatExportPageCount(count: number): string {
  return `${count}ページを書き出す`;
}
