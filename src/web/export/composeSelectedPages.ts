import { cloneEditorDocument } from '../../domain/document';
import type { EditorDocument, PageId } from '../../domain/types';
import { isPngBuffer } from '../ink/fakeCanvas';
import {
  closeCanvasImage,
  composePageJpeg,
  composePagePng,
  createExportCanvas,
  decodeExportPng,
  loadPageTemplateImage,
  type ExportCanvas,
} from './composePagePng';
import { MAX_WORKSPACE_EXPORT_PAGES } from './constants';
import { throwIfAborted, WorkspaceExportAbortedError, WorkspaceExportError } from './errors';
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
  workspaceNumber: number;
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

export type ComposedExportPage = {
  workspaceNumber: number;
  bytes: Uint8Array;
};

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function composeSelectedPages(
  present: EditorDocument,
  ink: InkExportSource,
  pageIds: readonly PageId[],
  encode: 'png' | 'jpeg',
  deps: ExportWorkspaceDeps = {},
): Promise<{ snapshot: EditorDocument; pages: ComposedExportPage[] }> {
  throwIfAborted(deps.signal);
  const snapshot = cloneEditorDocument(present);
  if (pageIds.length === 0 || pageIds.length > MAX_WORKSPACE_EXPORT_PAGES) {
    throw new WorkspaceExportError();
  }
  for (const pageId of pageIds) {
    if (!snapshot.pages[pageId] || !snapshot.workspaceOrder.includes(pageId)) {
      throw new WorkspaceExportError();
    }
  }

  const rasterIds = pageIds.map((pageId) => snapshot.pages[pageId]!.rasterId);
  ink.flushPendingEncodes();
  await waitForInkEncodes((rasterId) => ink.isEncoding(rasterId), rasterIds, deps.encodeWait);
  throwIfAborted(deps.signal);

  const pngCopies = copyRasterPngs(ink, rasterIds);
  const loadTemplate = deps.loadTemplate ?? loadPageTemplateImage;
  const composePage =
    deps.composePage ??
    (encode === 'jpeg' ? composePageJpeg : composePagePng);
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
  const pages: ComposedExportPage[] = [];

  for (let i = 0; i < pageIds.length; i += 1) {
    throwIfAborted(deps.signal);
    deps.onProgress?.({ current: i + 1, total: pageIds.length });
    await yieldBetweenPages();
    const pageId = pageIds[i]!;
    const page = snapshot.pages[pageId]!;
    const copy = pngCopies.get(page.rasterId)!;
    let inkBitmap: (CanvasImageSource & { close?: () => void }) | null = null;
    try {
      if (copy.byteLength > 0) {
        inkBitmap = await decodePng(copy);
      }
      const workspaceNumber = snapshot.workspaceOrder.indexOf(pageId) + 1;
      const bytes = await composePage({
        canvas,
        template,
        inkBitmap,
        texts: page.texts,
        width,
        height,
        workspaceNumber,
      });
      pages.push({
        workspaceNumber,
        bytes,
      });
    } catch (err) {
      closeCanvasImage(inkBitmap);
      if (err instanceof WorkspaceExportAbortedError || err instanceof WorkspaceExportError) {
        throw err;
      }
      throw new WorkspaceExportError();
    }
    closeCanvasImage(inkBitmap);
  }

  return { snapshot, pages };
}

export function copyRasterPngs(
  ink: InkExportSource,
  rasterIds: readonly string[],
): Map<string, ArrayBuffer> {
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
