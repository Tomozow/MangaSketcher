import type { PdfTextItem } from './types';

type PdfJsItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
};

function fontSizeFromTransform(transform: number[]): number {
  const a = transform[0] ?? 0;
  const b = transform[1] ?? 0;
  return Math.hypot(a, b);
}

function glyphFontSize(item: PdfJsItem): number {
  const fromTransform = fontSizeFromTransform(item.transform);
  const candidates = [item.width, item.height, fromTransform].filter(
    (n) => Number.isFinite(n) && n > 0 && n < 40,
  );
  if (candidates.length === 0) {
    return fromTransform || 12;
  }
  return Math.min(...candidates);
}

export function pdfJsItemsToDomain(items: PdfJsItem[]): PdfTextItem[] {
  return items.map((item) => {
    const fontSize = glyphFontSize(item);
    return {
      str: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width || fontSize,
      height: item.height || fontSize,
      fontSize,
    };
  });
}

export async function extractPdfSourceText(
  data: Uint8Array,
  load: (bytes: Uint8Array) => Promise<{
    numPages: number;
    getPage: (n: number) => Promise<{
      getTextContent: () => Promise<{ items: Array<PdfJsItem | { type?: string }> }>;
    }>;
  }>,
): Promise<{ pageCount: number; sourceTextByPage: Record<number, PdfTextItem[]> }> {
  const pdf = await load(data);
  const sourceTextByPage: Record<number, PdfTextItem[]> = {};
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const pdfPage = await pdf.getPage(page);
    const content = await pdfPage.getTextContent();
    const items = content.items.filter((item): item is PdfJsItem => 'str' in item && 'transform' in item);
    sourceTextByPage[page] = pdfJsItemsToDomain(items);
  }
  return { pageCount: pdf.numPages, sourceTextByPage };
}
