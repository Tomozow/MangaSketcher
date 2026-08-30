import { describe, expect, test, vi } from 'vitest';

vi.mock('@/src/storage/projectStore', () => ({
  writeProjectPdf: vi.fn(async () => 'opfs/path.pdf'),
}));

vi.mock('@/src/domain/pdfExtract', () => ({
  extractPdfSourceText: vi.fn(async () => ({ pageCount: 1, sourceTextByPage: {} })),
}));

vi.mock('@/src/domain/pdfView', () => ({
  pdfFileFingerprint: vi.fn(() => 'fp'),
}));

vi.mock('@/src/web/pdf/pdfSession', () => ({
  dropPdfSession: vi.fn(),
  getOrLoadPdfProxy: vi.fn(),
}));

import { importProjectPdf } from '../pdfImport';

describe('importProjectPdf', () => {
  test('runs checkpoint before reading the PDF file', async () => {
    const order: string[] = [];
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.pdf', { type: 'application/pdf' });

    await importProjectPdf(file, {
      projectId: 'p1',
      getPresent: () => ({
        projectId: 'p1',
        pdf: null,
      } as never),
      checkpointBeforeHeavyWork: async () => {
        order.push('checkpoint');
      },
      setPdfBytes: () => {
        order.push('setPdfBytes');
      },
      setPdfMissing: () => {
        order.push('setPdfMissing');
      },
      dispatch: () => {
        order.push('dispatch');
      },
    });

    expect(order[0]).toBe('checkpoint');
    expect(order).toContain('setPdfBytes');
    expect(order.indexOf('checkpoint')).toBeLessThan(order.indexOf('setPdfBytes'));
  });

  test('does not import when checkpoint fails', async () => {
    const file = new File([new Uint8Array([1])], 'sample.pdf', { type: 'application/pdf' });
    const setPdfBytes = vi.fn();

    await expect(
      importProjectPdf(file, {
        projectId: 'p1',
        getPresent: () => ({ projectId: 'p1', pdf: null } as never),
        checkpointBeforeHeavyWork: async () => {
          throw new Error('checkpoint failed');
        },
        setPdfBytes,
        setPdfMissing: vi.fn(),
        dispatch: vi.fn(),
      }),
    ).rejects.toThrow('checkpoint failed');

    expect(setPdfBytes).not.toHaveBeenCalled();
  });
});
