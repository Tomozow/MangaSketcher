/** ページ番号が変わるとキーが変わるので、ビューアは再マウント／再描画する。 */
export function pdfPageViewerKey(opfsPath: string, currentPage: number, generation: number): string {
  return `${opfsPath}#g=${generation}#page=${clampPdfPage(currentPage, Number.MAX_SAFE_INTEGER)}`;
}

export function clampPdfPage(page: number, pageCount: number): number {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const n = Math.floor(page);
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.min(count, Math.max(1, n));
}
