import { describe, expect, test } from 'vitest';
import { createEditorDocument, sequentialIds } from '../../../domain/document';
import { WorkspaceExportError } from '../errors';
import type { InkExportSource } from '../exportWorkspace';
import { exportWorkspaceMiniJpg } from '../exportWorkspaceMiniJpg';

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

function stubSheetDeps() {
  const painted: string[] = [];
  return {
    painted,
    loadTemplate: async () => ({}) as CanvasImageSource,
    composePage: async () => new Uint8Array([1, 2, 3]),
    createCanvas: () =>
      ({
        getContext: () => ({
          fillStyle: '',
          font: '',
          textAlign: 'center',
          textBaseline: 'middle',
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          fillRect() {},
          drawImage() {},
          fillText(text: string) {
            painted.push(text);
          },
          measureText: (text: string) => ({ width: text.length * 10 }),
        }),
        convertToBlob: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }),
      }) as unknown as OffscreenCanvas,
    decodePng: async () => ({}) as CanvasImageSource,
    yieldBetweenPages: async () => {},
    now: new Date(2026, 8, 1, 14, 0, 0),
  };
}

describe('exportWorkspaceMiniJpg', () => {
  test('rejects an empty workspace', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    doc.workspaceOrder = [];
    await expect(exportWorkspaceMiniJpg(doc, mockInk(), stubSheetDeps())).rejects.toBeInstanceOf(
      WorkspaceExportError,
    );
  });

  test('writes one jpeg of the whole workspace', async () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: '原稿',
      pageCount: 3,
      ids: sequentialIds('pg'),
    });
    const deps = stubSheetDeps();
    const file = await exportWorkspaceMiniJpg(doc, mockInk(), deps);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('原稿_20260901-1400_mininame.jpg');
    expect(deps.painted).toContain('原稿');
    expect(deps.painted).toContain('2026年9月1日 14:00');
  });
});
