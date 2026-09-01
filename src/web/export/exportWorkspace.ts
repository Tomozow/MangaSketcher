import type { EditorDocument, PageId } from '../../domain/types';
import { buildExportText } from './buildExportText';
import { buildPageExportFileName, folderNameFromExportFileName } from './buildPageExportFileName';
import { buildWorkspaceZip } from './buildWorkspaceZip';
import { composeSelectedPages, type ExportWorkspaceDeps, type InkExportSource } from './composeSelectedPages';
import type { PageScopeMode } from './exportFormat';
import { formatExportTimestamp, sanitizeExportStem } from './sanitizeExportName';

export type { ExportProgress, ExportWorkspaceDeps, InkExportSource } from './composeSelectedPages';

export async function exportWorkspace(
  present: EditorDocument,
  ink: InkExportSource,
  deps: ExportWorkspaceDeps & {
    pageIds?: readonly PageId[];
    pick?: PageScopeMode;
  } = {},
): Promise<File> {
  const pageIds = deps.pageIds ?? present.workspaceOrder;
  const pick = deps.pick ?? 'all';
  const { snapshot, pages } = await composeSelectedPages(present, ink, pageIds, 'png', deps);
  const timestamp = formatExportTimestamp(deps.now ?? new Date());
  const stem = sanitizeExportStem(snapshot.name);
  const firstNumber = pages[0]?.workspaceNumber ?? 1;
  const lastNumber = pages[pages.length - 1]?.workspaceNumber ?? firstNumber;
  const fileName = buildPageExportFileName({
    format: 'png',
    stem,
    timestamp,
    pick,
    count: pages.length,
    firstNumber,
    lastNumber,
  });

  if (pages.length === 1) {
    const png = pages[0]!.bytes;
    const copy = new Uint8Array(png.byteLength);
    copy.set(png);
    const blob = new Blob([copy.buffer], { type: 'image/png' });
    return new File([blob], fileName, { type: 'image/png', lastModified: Date.now() });
  }

  const text = buildExportText(snapshot, pageIds);
  const folderName = folderNameFromExportFileName(fileName);
  const bytes = buildWorkspaceZip({
    folderName,
    pages: pages.map((page) => ({ index: page.workspaceNumber, png: page.bytes })),
    text,
  });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'application/zip' });
  return new File([blob], fileName, { type: 'application/zip', lastModified: Date.now() });
}
