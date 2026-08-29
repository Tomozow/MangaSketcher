import { cloneEditorDocument } from '../../domain/document';
import type { EditorDocument } from '../../domain/types';
import { isPngBuffer } from '../ink/fakeCanvas';
import { buildExportText } from './buildExportText';
import { buildWorkspaceZip } from './buildWorkspaceZip';
import {
  closeCanvasImage,
  composePagePng,
  createExportCanvas,
  decodeExportPng,
  loadPageTemplateImage,
  type ExportCanvas,
} from './composePagePng';
import { MAX_WORKSPACE_EXPORT_PAGES } from './constants';
import { throwIfAborted, WorkspaceExportAbortedError, WorkspaceExportError } from './errors';
import { buildExportZipNames, formatExportTimestamp, sanitizeExportStem } from './sanitizeExportName';
import { waitForInkEncodes, type EncodeWaitClock } from './waitForInkEncode';

export type InkExportSource = {
  flushPendingEncodes(): void;
  isEncoding(rasterId: string): boolean;
  captureRasterPng(rasterId: string): ArrayBuffer | undefined;
};

export type ExportProgress = {
  current: number;
  total: number;
};

export type ComposeExportedPage = (input: {
  canvas: ExportCanvas;
  template: CanvasImageSource;
  inkBitmap: CanvasImageSource | null;
  texts: EditorDocument['pages'][string]['texts'];
  width: number;
  height: number;
}) => Promise<Uint8Array>;

export type ExportWorkspaceDeps = {
  loadTemplate?: () => Promise<CanvasImageSource>;
  composePage?: ComposeExportedPage;
  createCanvas?: (width: number, height: number) => ExportCanvas;
  decodePng?: (buffer: ArrayBuffer) => Promise<CanvasImageSource & { close?: () => void }>;
  yieldBetweenPages?: () => Promise<void>;
  now?: Date;
  signal?: AbortSignal;
  encodeWait?: EncodeWaitClock;
  onProgress?: (progress: ExportProgress) => void;
};

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function exportWorkspace(
  present: EditorDocument,
  ink: InkExportSource,
  deps: ExportWorkspaceDeps = {},
): Promise<File> {
  throwIfAborted(deps.signal);
  const snapshot = cloneEditorDocument(present);
  if (snapshot.workspaceOrder.length > MAX_WORKSPACE_EXPORT_PAGES) {
    throw new WorkspaceExportError();
  }
  for (const pageId of snapshot.workspaceOrder) {
    if (!snapshot.pages[pageId]) {
      throw new WorkspaceExportError();
    }
  }

  const timestamp = formatExportTimestamp(deps.now ?? new Date());
  const stem = sanitizeExportStem(snapshot.name);
  const names = buildExportZipNames(stem, timestamp);
  const text = buildExportText(snapshot);

  if (snapshot.workspaceOrder.length === 0) {
    return zipToFile(names, [], text);
  }

  const rasterIds = snapshot.workspaceOrder.map((pageId) => snapshot.pages[pageId]!.rasterId);
  ink.flushPendingEncodes();
  await waitForInkEncodes((rasterId) => ink.isEncoding(rasterId), rasterIds, deps.encodeWait);
  throwIfAborted(deps.signal);

  const pngCopies = copyRasterPngs(ink, rasterIds);
  const loadTemplate = deps.loadTemplate ?? loadPageTemplateImage;
  const composePage = deps.composePage ?? composePagePng;
  const createCanvas = deps.createCanvas ?? createExportCanvas;
  const decodePng = deps.decodePng ?? decodeExportPng;
  const yieldBetweenPages = deps.yieldBetweenPages ?? defaultYield;
  const width = snapshot.rasterWidth;
  const height = snapshot.rasterHeight;
  let template: CanvasImageSource;
  try {
    template = await loadTemplate();
  } catch (err) {
    if (err instanceof WorkspaceExportAbortedError) {
      throw err;
    }
    throw err instanceof WorkspaceExportError ? err : new WorkspaceExportError();
  }
  let canvas: ExportCanvas;
  try {
    canvas = createCanvas(width, height);
  } catch (err) {
    if (err instanceof WorkspaceExportAbortedError) {
      throw err;
    }
    throw err instanceof WorkspaceExportError ? err : new WorkspaceExportError();
  }
  const pages: { index: number; png: Uint8Array }[] = [];

  for (let i = 0; i < snapshot.workspaceOrder.length; i += 1) {
    throwIfAborted(deps.signal);
    deps.onProgress?.({ current: i + 1, total: snapshot.workspaceOrder.length });
    await yieldBetweenPages();
    const pageId = snapshot.workspaceOrder[i]!;
    const page = snapshot.pages[pageId]!;
    const copy = pngCopies.get(page.rasterId)!;
    let inkBitmap: (CanvasImageSource & { close?: () => void }) | null = null;
    try {
      if (copy.byteLength > 0) {
        inkBitmap = await decodePng(copy);
      }
      const png = await composePage({
        canvas,
        template,
        inkBitmap,
        texts: page.texts,
        width,
        height,
      });
      pages.push({ index: i + 1, png });
    } catch (err) {
      closeCanvasImage(inkBitmap);
      if (err instanceof WorkspaceExportAbortedError || err instanceof WorkspaceExportError) {
        throw err;
      }
      throw new WorkspaceExportError();
    }
    closeCanvasImage(inkBitmap);
  }

  return zipToFile(names, pages, text);
}

function zipToFile(
  names: { zipFileName: string; folderName: string },
  pages: readonly { index: number; png: Uint8Array }[],
  text: string,
): File {
  const bytes = buildWorkspaceZip({
    folderName: names.folderName,
    pages,
    text,
  });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'application/zip' });
  return new File([blob], names.zipFileName, { type: 'application/zip', lastModified: Date.now() });
}

function copyRasterPngs(ink: InkExportSource, rasterIds: readonly string[]): Map<string, ArrayBuffer> {
  const copies = new Map<string, ArrayBuffer>();
  for (const rasterId of new Set(rasterIds)) {
    const captured = ink.captureRasterPng(rasterId);
    if (captured === undefined) {
      throw new WorkspaceExportError();
    }
    const copy = captured.slice(0);
    if (copy.byteLength > 0 && !isPngBuffer(copy)) {
      throw new WorkspaceExportError();
    }
    copies.set(rasterId, copy);
  }
  return copies;
}
