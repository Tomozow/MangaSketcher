import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  PDF_VIEW_SESSION_STORAGE_KEY,
  applyPdfViewSession,
  loadPdfViewSession,
  savePdfViewSession,
} from '../pdfViewSession';
import type { EditorDocument } from '../types';

const memory = new Map<string, string>();

function installMemoryStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => {
      memory.clear();
    },
    key: () => null,
    length: 0,
  });
}

function sampleDoc(): EditorDocument {
  return {
    projectId: 'p1',
    name: 'test',
    rasterWidth: 16,
    rasterHeight: 20,
    pages: { a: { id: 'a', texts: [], rasterId: 'p1:page:a' } },
    workspaceOrder: ['a'],
    stock: [],
    trash: [],
    pasteboardClips: [],
    pasteboardTexts: [],
    selectedPageId: 'a',
    selectedClipId: null,
    selectedTextId: null,
    tool: 'pen',
    tools: {
      penColor: '#1A1A1A',
      penSize: 12,
      penOpacity: 1,
      eraserSize: 28,
      eraserOpacity: 1,
      textColor: '#1A1A1A',
      textFontSize: 36,
      pressureEnabled: true,
    },
    pdf: {
      pageCount: 10,
      currentPage: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      sourceTextByPage: {},
      opfsPath: 'pdfs/p1.pdf',
      generation: 1,
      sourceFingerprint: 'novel.pdf:10:1',
    },
    workspaceZoom: 1,
    workspacePanX: 0,
    workspacePanY: 0,
    stockZoom: 1,
    stockPanX: 0,
    stockPanY: 0,
    workspacePdfSplit: 0.58,
    paletteStockSplit: 0.46,
    pdfViewerVisible: true,
    sidebarCompact: false,
    stockLayout: 'free',
    stockPane: 'stock',
    pagesPerColumn: 0,
    pairGap: 4,
    showPairDivider: false,
    columnGap: 0,
    inkGeneration: 0,
  };
}

afterEach(() => {
  memory.clear();
  vi.unstubAllGlobals();
});

describe('pdfViewSession', () => {
  test('プロジェクトごとに最後のページを保存して読み戻す', () => {
    installMemoryStorage();
    savePdfViewSession('p1', { currentPage: 7, zoom: 1.2, panX: 3, panY: 4, fingerprint: 'novel.pdf:10:1' });
    expect(JSON.parse(memory.get(PDF_VIEW_SESSION_STORAGE_KEY)!).p1.currentPage).toBe(7);
    expect(loadPdfViewSession('p1')).toEqual({
      currentPage: 7,
      zoom: 1.2,
      panX: 3,
      panY: 4,
      fingerprint: 'novel.pdf:10:1',
    });
  });

  test('同じ指紋なら起動ドキュメントのページを上書きする', () => {
    const doc = sampleDoc();
    const next = applyPdfViewSession(doc, {
      currentPage: 6,
      zoom: 2,
      panX: 1,
      panY: 2,
      fingerprint: 'novel.pdf:10:1',
    });
    expect(next.pdf?.currentPage).toBe(6);
    expect(next.pdf?.zoom).toBe(2);
  });

  test('別指紋のセッションは無視する', () => {
    const doc = sampleDoc();
    const next = applyPdfViewSession(doc, {
      currentPage: 6,
      zoom: 2,
      panX: 1,
      panY: 2,
      fingerprint: 'other.pdf:1:1',
    });
    expect(next.pdf?.currentPage).toBe(1);
  });
});
