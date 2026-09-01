import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, test } from 'vitest';
import { createEditorDocument, sequentialIds } from '../../../domain/document';
import type { EditorDocument } from '../../../domain/types';
import { MAX_WORKSPACE_EXPORT_PAGES } from '../constants';
import { WorkspaceExportError } from '../errors';
import { exportWorkspace, type InkExportSource } from '../exportWorkspace';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

function pngBuffer(): ArrayBuffer {
  return PNG_SIGNATURE.buffer.slice(
    PNG_SIGNATURE.byteOffset,
    PNG_SIGNATURE.byteOffset + PNG_SIGNATURE.byteLength,
  );
}

function mockInk(pngs: Record<string, ArrayBuffer | undefined>): InkExportSource {
  return {
    flushPendingEncodes() {},
    isEncoding() {
      return false;
    },
    captureRasterPng(rasterId) {
      return pngs[rasterId];
    },
  };
}

function stubComposeDeps() {
  return {
    loadTemplate: async () => ({}) as CanvasImageSource,
    composePage: async () => new Uint8Array([1, 2, 3]),
    createCanvas: () =>
      ({
        getContext: () => ({}),
      }) as unknown as OffscreenCanvas,
    decodePng: async () => ({}) as CanvasImageSource,
    yieldBetweenPages: async () => {},
    now: new Date(2026, 7, 29, 15, 22, 0),
  };
}

function rasterMap(doc: EditorDocument, buffer: ArrayBuffer | undefined): Record<string, ArrayBuffer | undefined> {
  const pngs: Record<string, ArrayBuffer | undefined> = {};
  for (const pageId of doc.workspaceOrder) {
    pngs[doc.pages[pageId]!.rasterId] = buffer;
  }
  return pngs;
}

describe('exportWorkspace', () => {
  test('rejects more than 200 pages without composing', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'big',
      pageCount: MAX_WORKSPACE_EXPORT_PAGES + 1,
      ids: sequentialIds('pg'),
    });
    let composed = 0;
    await expect(
      exportWorkspace(doc, mockInk(rasterMap(doc, new ArrayBuffer(0))), {
        ...stubComposeDeps(),
        composePage: async () => {
          composed += 1;
          return new Uint8Array([1]);
        },
      }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
    expect(composed).toBe(0);
  });

  test('unregistered raster fails the whole export', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    await expect(
      exportWorkspace(doc, mockInk(rasterMap(doc, undefined)), stubComposeDeps()),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
  });

  test('invalid png fails the whole export', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    const bad = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    await expect(
      exportWorkspace(doc, mockInk(rasterMap(doc, bad)), stubComposeDeps()),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
  });

  test('decode failure fails the whole export', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    await expect(
      exportWorkspace(doc, mockInk(rasterMap(doc, pngBuffer())), {
        ...stubComposeDeps(),
        decodePng: async () => {
          throw new WorkspaceExportError();
        },
      }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
  });

  test('encode timeout fails the whole export', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    let now = 0;
    await expect(
      exportWorkspace(
        doc,
        {
          flushPendingEncodes() {},
          isEncoding() {
            return true;
          },
          captureRasterPng() {
            return new ArrayBuffer(0);
          },
        },
        {
          ...stubComposeDeps(),
          encodeWait: {
            timeoutMs: 15_000,
            pollMs: 50,
            now: () => now,
            sleep: async (ms) => {
              now += ms;
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
  });

  test('copies all rasters before any compose so later strokes cannot mix in', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 3,
      ids: sequentialIds('pg'),
    });
    const order: string[] = [];
    const ink: InkExportSource = {
      flushPendingEncodes() {
        order.push('flush');
      },
      isEncoding() {
        order.push('encode');
        return false;
      },
      captureRasterPng(rasterId) {
        order.push(`capture:${rasterId}`);
        return new ArrayBuffer(0);
      },
    };
    await exportWorkspace(doc, ink, {
      ...stubComposeDeps(),
      composePage: async () => {
        order.push('compose');
        return new Uint8Array([1]);
      },
    });
    const firstCompose = order.indexOf('compose');
    const captures = order.filter((item) => item.startsWith('capture:'));
    expect(captures).toHaveLength(3);
    expect(order.indexOf('flush')).toBeLessThan(firstCompose);
    expect(Math.max(...captures.map((item) => order.indexOf(item)))).toBeLessThan(firstCompose);
  });

  test('20 pages produce 20 pngs and text.txt', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: '二十面',
      pageCount: 20,
      ids: sequentialIds('pg'),
    });
    const file = await exportWorkspace(doc, mockInk(rasterMap(doc, new ArrayBuffer(0))), stubComposeDeps());
    const zip = new Uint8Array(await file.arrayBuffer());
    const unzipped = unzipSync(zip);
    const pngs = Object.keys(unzipped).filter((path) => path.endsWith('.png'));
    expect(pngs).toHaveLength(20);
    expect(Object.keys(unzipped).some((path) => path.endsWith('text.txt'))).toBe(true);
    expect(file.name.startsWith('二十面_')).toBe(true);
    expect(file.name.endsWith('.zip')).toBe(true);
    expect(file.name.includes('_p')).toBe(false);
    const textEntry = Object.entries(unzipped).find(([path]) => path.endsWith('text.txt'))![1];
    expect(strFromU8(textEntry).split('===').length).toBeGreaterThan(20);
  });

  test('1 page is a png file named with p001', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: '一枚',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    const file = await exportWorkspace(doc, mockInk(rasterMap(doc, new ArrayBuffer(0))), stubComposeDeps());
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('一枚_20260829-1522_p001.png');
  });

  test('template load failure fails the whole export', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    await expect(
      exportWorkspace(doc, mockInk(rasterMap(doc, new ArrayBuffer(0))), {
        ...stubComposeDeps(),
        loadTemplate: async () => {
          throw new Error('missing');
        },
      }),
    ).rejects.toBeInstanceOf(WorkspaceExportError);
  });
});
