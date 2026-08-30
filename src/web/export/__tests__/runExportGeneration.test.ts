import { describe, expect, test, vi } from 'vitest';
import { createEditorDocument, sequentialIds } from '../../../domain/document';
import { runExportGeneration } from '../runExportGeneration';

describe('runExportGeneration', () => {
  test('awaits onBeforeExport before exportWorkspace', async () => {
    const order: string[] = [];
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    const pageId = doc.workspaceOrder[0]!;
    const inkEngine = {
      flushPendingEncodes: vi.fn(),
      isEncoding: () => false,
      captureRasterPng: () => new ArrayBuffer(0),
    };

    await runExportGeneration({
      doc,
      inkEngine: inkEngine as never,
      onBeforeExport: async () => {
        order.push('checkpoint');
      },
      deps: {
        loadTemplate: async () => ({}) as CanvasImageSource,
        composePage: async () => new Uint8Array([1]),
        createCanvas: () => ({ getContext: () => ({}) }) as unknown as OffscreenCanvas,
        decodePng: async () => ({}) as CanvasImageSource,
        yieldBetweenPages: async () => {},
        now: new Date(2026, 7, 29, 15, 22, 0),
      },
    });

    expect(order).toEqual(['checkpoint']);
    expect(inkEngine.flushPendingEncodes).toHaveBeenCalled();
  });
});
