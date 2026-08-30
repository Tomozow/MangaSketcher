'use client';

import { useEffect, useId, useState } from 'react';
import type { PdfExtractedGlyph, PdfTextItem } from '@/src/domain/types';
import { styles } from '@/src/web/editorStyles';
import { PdfPageViewer, type PdfExtractPayload } from './PdfPageViewer';
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
  extractedGlyphs?: PdfExtractedGlyph[];
  extractMarkersVisible?: boolean;
  extractSanitizePunctuation?: boolean;
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
  onExtractText?: (payload: PdfExtractPayload) => void;
  onToggleExtractMarkers?: (visible: boolean) => void;
  onToggleExtractSanitizePunctuation?: (enabled: boolean) => void;
};

export function PdfFileInput({
  inputId,
  onPickPdf,
  label,
  className = styles.pdfPickButton,
}: {
  inputId: string;
  onPickPdf?: (file: File) => void | Promise<void>;
  label: string;
  className?: string;
}) {
  return (
    <>
      <label htmlFor={inputId} className={className}>
        {label}
      </label>
      <span className={styles.pdfFileInputWrap}>
        <input
          id={inputId}
          type="file"
          accept="application/pdf,application/x-pdf"
          className={styles.pdfFileInput}
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && onPickPdf) {
              void onPickPdf(file);
            }
            event.target.value = '';
          }}
        />
      </span>
    </>
  );
}

export function PdfPane({
  visible,
  hasPdf,
  pdfMissing,
  pdfBytes,
  pdf,
  onViewChange,
  onPickPdf,
  onExtractText,
  onToggleExtractMarkers,
  onToggleExtractSanitizePunctuation,
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
        <PdfFileInput inputId={inputId} onPickPdf={onPickPdf} label="PDF を選び直す" />
      </div>
    );
  }

  if (!hasPdf || !pdf) {
    return (
      <div className={styles.pdfPlaceholder}>
        <PdfFileInput inputId={inputId} onPickPdf={onPickPdf} label="PDF を選択" />
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
      extractedGlyphs={pdf.extractedGlyphs}
      extractMarkersVisible={pdf.extractMarkersVisible !== false}
      extractSanitizePunctuation={pdf.extractSanitizePunctuation === true}
      mediaWidth={mediaSize.width}
      mediaHeight={mediaSize.height}
      onViewChange={onViewChange}
      onExtractText={onExtractText}
      onToggleExtractMarkers={onToggleExtractMarkers}
      onToggleExtractSanitizePunctuation={onToggleExtractSanitizePunctuation}
      navLeading={
        onPickPdf ? (
          <PdfFileInput inputId={inputId} onPickPdf={onPickPdf} label="別のPDF" className={styles.pdfNavButton} />
        ) : null
      }
    />
  );
}

/** @deprecated Gate 12 — use PdfPane */
export const PdfPanePlaceholder = PdfPane;
