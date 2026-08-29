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
  const w = item.width;
  const h = item.height;
  const vertical = Number.isFinite(h) && Number.isFinite(w) && h > w * 1.25;
  if (vertical && w > 0) {
    return w;
  }
  if (fromTransform > 0 && fromTransform < 80) {
    return fromTransform;
  }
  return (w > 0 && w < 80 ? w : 12) || 12;
}

function explodeVerticalRun(item: PdfTextItem): PdfTextItem[] {
  const chars = [...item.str];
  const em = Math.max(1, item.fontSize || item.width || 1);
  const run = item.height || em;
  if (chars.length <= 1 || run <= em * 1.35) {
    return [item];
  }
  const step = run / chars.length;
  const originY = item.y;
  return chars.map((str, index) => ({
    ...item,
    str,
    y: originY - (index + 1) * step,
    width: item.width || em,
    height: step,
    fontSize: em,
  }));
}

export function pdfJsItemsToDomain(items: PdfJsItem[]): PdfTextItem[] {
  return items.flatMap((item) => {
    const fontSize = glyphFontSize(item);
    const domain: PdfTextItem = {
      str: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width || fontSize,
      height: item.height || fontSize,
      fontSize,
    };
    return explodeVerticalRun(domain);
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
