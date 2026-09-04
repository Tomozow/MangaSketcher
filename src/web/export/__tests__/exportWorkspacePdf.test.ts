import { PDFDocument, PDFName, ReadingDirection } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { createEditorDocument, sequentialIds } from '../../../domain/document';
import { DEFAULT_RASTER_HEIGHT, DEFAULT_RASTER_WIDTH } from '../../../domain/types';
import { WorkspaceExportError } from '../errors';
import type { InkExportSource } from '../exportWorkspace';
import { exportWorkspacePdf } from '../exportWorkspacePdf';
import { PDF_EXPORT_SCALE } from '../constants';

const JPEG_1X1 = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAC+AB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/AL+f/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwB//9k=',
  ),
  (char) => char.charCodeAt(0),
);

function mockInk(): InkExportSource {
  return {
    flushPendingEncodes() {},
    isEncoding() {
      return false;
    },
    captureRasterPng() {
      return new ArrayBuffer(0);
    },
  };
}

function stubJpegDeps() {
  return {
    loadTemplate: async () => ({}) as CanvasImageSource,
    composePage: async () => JPEG_1X1,
    createCanvas: () =>
      ({
        getContext: () => ({}),
      }) as unknown as OffscreenCanvas,
    decodePng: async () => ({}) as CanvasImageSource,
    yieldBetweenPages: async () => {},
    now: new Date(2026, 8, 1, 14, 0, 0),
  };
}

describe('exportWorkspacePdf', () => {
  test('rejects an empty page set', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    await expect(
      exportWorkspacePdf(doc, mockInk(), { ...stubJpegDeps(), pageIds: [] }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
  });

  test('embeds one page per manuscript page with R2L and workspace bookmarks', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: '原稿',
      pageCount: 4,
      ids: sequentialIds('pg'),
    });
    const pageIds = doc.workspaceOrder.slice(1, 4);
    const file = await exportWorkspacePdf(doc, mockInk(), {
      ...stubJpegDeps(),
      pageIds,
      pick: 'range',
    });
    expect(file.type).toBe('application/pdf');
    expect(file.name).toBe('原稿_20260901-1400_p002-p004.pdf');
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getTitle()).toBe('原稿');
    expect(pdf.getCreator()).toBe('MangaSketcher');
    expect(pdf.catalog.get(PDFName.of('PageLayout'))).toBe(PDFName.of('SinglePage'));
    expect(pdf.catalog.getOrCreateViewerPreferences().getReadingDirection()).toBe(
      ReadingDirection.R2L,
    );
    expect(pdf.catalog.has(PDFName.of('Outlines'))).toBe(true);
    const labels = pdfDocLabelsStart(pdf);
    expect(labels).toBe(2);
  });

  test('embeds full-resolution JPEG on a half-size page', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: '原稿',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    const sizes: Array<{ w: number; h: number }> = [];
    const composed: Array<{ w: number; h: number }> = [];
    const file = await exportWorkspacePdf(doc, mockInk(), {
      ...stubJpegDeps(),
      createCanvas: (w, h) => {
        sizes.push({ w, h });
        return { getContext: () => ({}) } as unknown as OffscreenCanvas;
      },
      composePage: async (input) => {
        composed.push({ w: input.width, h: input.height });
        return JPEG_1X1;
      },
    });
    const halfW = Math.round(DEFAULT_RASTER_WIDTH * PDF_EXPORT_SCALE);
    const halfH = Math.round(DEFAULT_RASTER_HEIGHT * PDF_EXPORT_SCALE);
    expect(sizes).toEqual([{ w: DEFAULT_RASTER_WIDTH, h: DEFAULT_RASTER_HEIGHT }]);
    expect(composed).toEqual([{ w: DEFAULT_RASTER_WIDTH, h: DEFAULT_RASTER_HEIGHT }]);
    const pdf = await PDFDocument.load(await file.arrayBuffer());
    expect(pdf.getPage(0).getSize()).toEqual({ width: halfW, height: halfH });
  });

  test('passes workspace numbers into jpeg compose', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: '原稿',
      pageCount: 4,
      ids: sequentialIds('pg'),
    });
    const pageIds = doc.workspaceOrder.slice(1, 4);
    const numbers: number[] = [];
    await exportWorkspacePdf(doc, mockInk(), {
      ...stubJpegDeps(),
      pageIds,
      pick: 'range',
      composePage: async (input) => {
        numbers.push(input.workspaceNumber);
        return JPEG_1X1;
      },
    });
    expect(numbers).toEqual([2, 3, 4]);
  });
});

function pdfDocLabelsStart(pdf: PDFDocument): number | undefined {
  const labels = pdf.catalog.lookup(PDFName.of('PageLabels'));
  if (!labels) {
    return undefined;
  }
  const asString = String(labels);
  const match = asString.match(/St[:\s]+(\d+)/);
  return match ? Number(match[1]) : undefined;
}
