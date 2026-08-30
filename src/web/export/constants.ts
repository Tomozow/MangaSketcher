export const MAX_WORKSPACE_EXPORT_PAGES = 200;
export const INK_ENCODE_WAIT_TIMEOUT_MS = 15_000;
export const INK_ENCODE_POLL_MS = 50;
export const DOWNLOAD_OBJECT_URL_REVOKE_MS = 60_000;
export const PAGE_TEMPLATE_URL = '/page_template.jpg';
export const EXPORT_FAILED_MESSAGE = '書き出しに失敗しました';
export const EXPORT_SHARE_LABEL = '"ファイル"に保存';
export const EXPORT_DOWNLOAD_LABEL = 'ダウンロード';
export const EXPORT_BUTTON_LABEL = '書き出し';
export const PROJECT_PACK_EXPORT_LABEL = 'プロジェクトファイルを書き出し';
export const EXPORT_PROGRESS_ELLIPSIS = '\u2026';

export function formatExportProgress(current: number, total: number): string {
  return `${current}/${total} ページ${EXPORT_PROGRESS_ELLIPSIS}`;
}

export function padPageIndex(index: number): string {
  return String(index).padStart(3, '0');
}
