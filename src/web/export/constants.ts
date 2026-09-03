export const MAX_WORKSPACE_EXPORT_PAGES = 200;
export const INK_ENCODE_WAIT_TIMEOUT_MS = 15_000;
export const INK_ENCODE_POLL_MS = 50;
export const DOWNLOAD_OBJECT_URL_REVOKE_MS = 60_000;
export const PAGE_TEMPLATE_URL = '/page_template.jpg';
export const EXPORT_FAILED_MESSAGE = '書き出しに失敗しました';
export const EXPORT_DOWNLOAD_LABEL = 'ダウンロード';
export const EXPORT_BUTTON_LABEL = '書き出し';
export const PROJECT_PACK_EXPORT_LABEL = 'プロジェクトファイルを書き出し';
export const EXPORT_CANCEL_LABEL = 'キャンセル';
export const EXPORT_PROGRESS_ELLIPSIS = '\u2026';
export const PDF_JPEG_QUALITY = 0.8;
export const MINI_NAME_JPEG_QUALITY = 0.92;
/** Longest edge of the mini-name JPEG, in pixels. */
export const MINI_NAME_MAX_EDGE = 8192;
/** Tile width in the sheet before fitting to MINI_NAME_MAX_EDGE. */
export const MINI_NAME_TILE_WIDTH = 720;
export const MINI_NAME_BLANK_FILL = '#EEEEEE';
export const MINI_NAME_COVER_FILL = '#FFFFFF';
export const MINI_NAME_SHEET_FILL = '#FFFFFF';
export const MINI_NAME_NUMBER_FILL = '#1A1A1A';

export function formatExportProgress(current: number, total: number): string {
  return `${current}/${total} ページ${EXPORT_PROGRESS_ELLIPSIS}`;
}

export function padPageIndex(index: number): string {
  return String(index).padStart(3, '0');
}
