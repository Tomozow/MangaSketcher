import { pageTextCanvasFont } from '../pageTextFont';
import type { EditorDocument } from '../../domain/types';
import {
  canvasToJpegBytes,
  closeCanvasImage,
  createExportCanvas,
  decodeExportPng,
  type ExportCanvas,
} from './composePagePng';
import { composeSelectedPages, type ExportWorkspaceDeps, type InkExportSource } from './composeSelectedPages';
import {
  MINI_NAME_BLANK_FILL,
  MINI_NAME_COVER_FILL,
  MINI_NAME_JPEG_QUALITY,
  MINI_NAME_NUMBER_FILL,
  MINI_NAME_SHEET_FILL,
} from './constants';
import { throwIfAborted, WorkspaceExportAbortedError, WorkspaceExportError } from './errors';
import {
  formatMiniNameCoverDateTime,
  miniNameSheetLayout,
  wrapCoverText,
  type MiniNameTile,
  buildMiniNameFileName,
} from './miniNameLayout';
import { formatExportTimestamp, sanitizeExportStem } from './sanitizeExportName';

export async function exportWorkspaceMiniJpg(
  present: EditorDocument,
  ink: InkExportSource,
  deps: ExportWorkspaceDeps = {},
): Promise<File> {
  const exportedAt = deps.now ?? new Date();
  const pageIds = present.workspaceOrder;
  const { snapshot, pages } = await composeSelectedPages(present, ink, pageIds, 'png', deps);
  const layout = miniNameSheetLayout(snapshot);
  if (layout.tiles.every((tile) => tile.kind !== 'page')) {
    throw new WorkspaceExportError();
  }

  const byNumber = new Map(pages.map((page) => [page.workspaceNumber, page.bytes]));
  const createCanvas = deps.createCanvas ?? createExportCanvas;
  const decodePng = deps.decodePng ?? decodeExportPng;
  let sheet: ExportCanvas;
  try {
    sheet = createCanvas(layout.width, layout.height);
  } catch (err) {
    if (err instanceof WorkspaceExportAbortedError) {
      throw err;
    }
    throw err instanceof WorkspaceExportError ? err : new WorkspaceExportError();
  }
  const ctx = sheet.getContext('2d');
  if (!ctx) {
    throw new WorkspaceExportError();
  }
  if ('imageSmoothingEnabled' in ctx) {
    ctx.imageSmoothingEnabled = true;
  }
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.fillStyle = MINI_NAME_SHEET_FILL;
  ctx.fillRect(0, 0, layout.width, layout.height);

  const numberPx = Math.max(10, Math.round(13 * layout.pixelScale));
  ctx.font = pageTextCanvasFont(numberPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const tile of layout.tiles) {
    throwIfAborted(deps.signal);
    if (tile.kind === 'blank' || tile.kind === 'cover') {
      ctx.fillStyle = tile.kind === 'cover' ? MINI_NAME_COVER_FILL : MINI_NAME_BLANK_FILL;
      ctx.fillRect(tile.x, tile.y, tile.width, tile.height);
      if (tile.kind === 'cover') {
        drawCoverCopy(ctx, tile, snapshot.name, formatMiniNameCoverDateTime(exportedAt));
      }
      continue;
    }
    const bytes = tile.workspaceNumber != null ? byNumber.get(tile.workspaceNumber) : undefined;
    if (!bytes) {
      throw new WorkspaceExportError();
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    let bitmap: (CanvasImageSource & { close?: () => void }) | null = null;
    try {
      bitmap = await decodePng(copy.buffer);
      ctx.drawImage(bitmap, tile.x, tile.y, tile.width, tile.height);
    } catch (err) {
      closeCanvasImage(bitmap);
      if (err instanceof WorkspaceExportAbortedError || err instanceof WorkspaceExportError) {
        throw err;
      }
      throw new WorkspaceExportError();
    }
    closeCanvasImage(bitmap);
    if (tile.workspaceNumber != null) {
      ctx.fillStyle = MINI_NAME_NUMBER_FILL;
      ctx.fillText(
        String(tile.workspaceNumber),
        tile.x + tile.width / 2,
        tile.y + tile.height + layout.numberBand / 2,
      );
    }
  }

  for (const divider of layout.dividers) {
    ctx.fillStyle = '#CCCCCC';
    ctx.fillRect(Math.round(divider.x), divider.y, Math.max(1, Math.round(layout.pixelScale)), divider.height);
  }

  let jpeg: Uint8Array;
  try {
    jpeg = await canvasToJpegBytes(sheet, MINI_NAME_JPEG_QUALITY);
  } catch (err) {
    if (err instanceof WorkspaceExportAbortedError || err instanceof WorkspaceExportError) {
      throw err;
    }
    throw new WorkspaceExportError();
  }
  const timestamp = formatExportTimestamp(exportedAt);
  const stem = sanitizeExportStem(snapshot.name);
  const fileName = buildMiniNameFileName(stem, timestamp);
  const fileCopy = new Uint8Array(jpeg.byteLength);
  fileCopy.set(jpeg);
  const blob = new Blob([fileCopy.buffer], { type: 'image/jpeg' });
  return new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() });
}

type CoverDrawContext = {
  fillStyle: string;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillText(text: string, x: number, y: number): void;
  measureText?(text: string): { width: number };
};

function drawCoverCopy(ctx: CoverDrawContext, tile: MiniNameTile, projectName: string, dateTime: string): void {
  const pad = tile.width * 0.1;
  const maxWidth = Math.max(1, tile.width - pad * 2);
  let titlePx = Math.max(14, Math.round(tile.width * 0.072));
  const datePx = Math.max(11, Math.round(tile.width * 0.045));
  const dateLine = datePx * 1.3;
  const maxBlock = tile.height - pad * 2;
  const measureAt = (px: number, line: string) => {
    ctx.font = pageTextCanvasFont(px);
    if (typeof ctx.measureText === 'function') {
      return ctx.measureText(line).width;
    }
    return line.length * px * 0.9;
  };
  let titleLine = titlePx * 1.25;
  let gap = titlePx * 0.45;
  let titleLines = wrapCoverText(projectName, maxWidth, (line) => measureAt(titlePx, line));
  while (titlePx > 12 && titleLines.length * titleLine + gap + dateLine > maxBlock) {
    titlePx -= 1;
    titleLine = titlePx * 1.25;
    gap = titlePx * 0.45;
    titleLines = wrapCoverText(projectName, maxWidth, (line) => measureAt(titlePx, line));
  }
  const blockH = titleLines.length * titleLine + gap + dateLine;
  const cx = tile.x + tile.width / 2;
  let y = tile.y + tile.height / 2 - blockH / 2 + titleLine / 2;
  ctx.fillStyle = MINI_NAME_NUMBER_FILL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = pageTextCanvasFont(titlePx);
  for (const line of titleLines) {
    ctx.fillText(line, cx, y);
    y += titleLine;
  }
  y += gap - titleLine / 2 + dateLine / 2;
  ctx.font = pageTextCanvasFont(datePx);
  ctx.fillText(dateTime, cx, y);
}
