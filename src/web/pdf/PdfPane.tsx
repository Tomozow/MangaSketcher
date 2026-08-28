'use client';

import { useEffect, useId, useState } from 'react';
import type { PdfTextItem, Rect } from '@/src/domain/types';
import styles from '@/src/web/editor.module.css';
import { PdfPageViewer } from './PdfPageViewer';
import { getOrLoadPdfProxy } from './pdfSession';

export type PdfPanePdfState = {
  opfsPath: string;
  generation: number;
  currentPage: number;
  pageCount: number;
  zoom: number;
  panX: number;
  panY: number;
  sourceTextByPage: Record<number, PdfTextItem[]>;
};

export type PdfPaneProps = {
  visible: boolean;
  hasPdf: boolean;
  pdfMissing: boolean;
  pdfBytes?: ArrayBuffer | null;
  pdf?: PdfPanePdfState | null;
  onViewChange?: (patch: {
    currentPage?: number;
    zoom?: number;
    panX?: number;
    panY?: number;
  }) => void;
  onPickPdf?: (file: File) => void | Promise<void>;
  onDropTextRange?: (payload: { pdfPage: number; range: Rect; preview: string }) => void;
};

export function PdfPane({
  visible,
  hasPdf,
  pdfMissing,
  pdfBytes,
  pdf,
  onViewChange,
  onPickPdf,
  onDropTextRange,
}: PdfPaneProps) {
  const inputId = useId();
  const [mediaSize, setMediaSize] = useState({ width: 1032, height: 729 });

  useEffect(() => {
    if (!pdfBytes || !pdf) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const proxy = await getOrLoadPdfProxy(pdf.opfsPath, pdf.generation, pdfBytes);
        const page = await proxy.getPage(pdf.currentPage);
        const viewport = page.getViewport({ scale: 1 });
        if (!cancelled) {
          setMediaSize({ width: viewport.width, height: viewport.height });
        }
      } catch {
        // keep fallback media for layout math
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfBytes, pdf?.opfsPath, pdf?.generation, pdf?.currentPage]);

  if (!visible) {
    return null;
  }

  if (pdfMissing) {
    return (
      <div className={styles.pdfPlaceholder}>
        <span>PDF ファイルが見つかりません。</span>
      </div>
    );
  }

  if (!hasPdf || !pdf) {
    return (
      <div className={styles.pdfPlaceholder}>
        <label htmlFor={inputId} className={styles.pdfPickButton}>
          PDF を選択
        </label>
        <input
          id={inputId}
          type="file"
          accept="application/pdf,application/x-pdf"
          className={styles.pdfFileInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && onPickPdf) {
              void onPickPdf(file);
            }
            event.target.value = '';
          }}
        />
        {!onPickPdf ? <span>PDF ピッカーはエディタ接続後に有効になります。</span> : null}
      </div>
    );
  }

  if (!pdfBytes) {
    return (
      <div className={styles.pdfPlaceholder}>
        <span>PDF を読み込み中…</span>
      </div>
    );
  }

  return (
    <PdfPageViewer
      opfsPath={pdf.opfsPath}
      generation={pdf.generation}
      currentPage={pdf.currentPage}
      pageCount={pdf.pageCount}
      zoom={pdf.zoom}
      panX={pdf.panX}
      panY={pdf.panY}
      pdfBytes={pdfBytes}
      sourceTextByPage={pdf.sourceTextByPage}
      mediaWidth={mediaSize.width}
      mediaHeight={mediaSize.height}
      onViewChange={onViewChange}
      onDropTextRange={onDropTextRange}
    />
  );
}

/** @deprecated Gate 12 — use PdfPane */
export const PdfPanePlaceholder = PdfPane;
