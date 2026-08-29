import { describe, expect, test } from 'vitest';

import { keepPdfViewOnReload, pdfFileFingerprint, pdfViewAfterLoad } from '../pdfView';
import type { PdfDocument } from '../types';

function pdf(partial: Partial<PdfDocument> = {}): PdfDocument {
  return {
    pageCount: 4,
    currentPage: 3,
    zoom: 1.4,
    panX: 12,
    panY: -8,
    sourceTextByPage: {},
    opfsPath: 'pdfs/p1.pdf',
    generation: 2,
    sourceFingerprint: 'novel.pdf:10:1',
    extractedGlyphs: [{ page: 3, x: 1, y: 2, width: 3, height: 4 }],
    extractMarkersVisible: false,
    extractSanitizePunctuation: true,
    ...partial,
  };
}

describe('pdf view restore', () => {
  test('fingerprint が同じならページと抽出印を残す', () => {
    const prev = pdf();
    expect(keepPdfViewOnReload(prev, { opfsPath: prev.opfsPath, fingerprint: prev.sourceFingerprint })).toBe(true);
    expect(pdfViewAfterLoad(prev, { opfsPath: prev.opfsPath, pageCount: 4, fingerprint: prev.sourceFingerprint })).toMatchObject({
      currentPage: 3,
      zoom: 1.4,
      panX: 12,
      panY: -8,
      extractMarkersVisible: false,
      extractSanitizePunctuation: true,
    });
    expect(pdfViewAfterLoad(prev, { opfsPath: prev.opfsPath, pageCount: 4, fingerprint: prev.sourceFingerprint }).extractedGlyphs).toHaveLength(1);
  });

  test('別ファイルなら 1 ページ目に戻す', () => {
    const prev = pdf();
    const next = pdfFileFingerprint({ name: 'other.pdf', size: 20, lastModified: 2 });
    expect(keepPdfViewOnReload(prev, { opfsPath: prev.opfsPath, fingerprint: next })).toBe(false);
    expect(pdfViewAfterLoad(prev, { opfsPath: prev.opfsPath, pageCount: 10, fingerprint: next }).currentPage).toBe(1);
  });

  test('指紋が無いレガシー再ロードは opfsPath が同じならページを残す', () => {
    const prev = pdf({ sourceFingerprint: undefined });
    expect(pdfViewAfterLoad(prev, { opfsPath: prev.opfsPath, pageCount: 4 }).currentPage).toBe(3);
  });
});
