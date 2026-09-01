import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  ReadingDirection,
  type PDFRef,
} from 'pdf-lib';
import type { EditorDocument, PageId } from '../../domain/types';
import { buildPageExportFileName } from './buildPageExportFileName';
import { composeSelectedPages, type ExportWorkspaceDeps, type InkExportSource } from './composeSelectedPages';
import { WorkspaceExportError } from './errors';
import type { PageScopeMode } from './exportFormat';
import { formatExportTimestamp, sanitizeExportStem } from './sanitizeExportName';

export async function exportWorkspacePdf(
  present: EditorDocument,
  ink: InkExportSource,
  deps: ExportWorkspaceDeps & {
    pageIds?: readonly PageId[];
    pick?: PageScopeMode;
  } = {},
): Promise<File> {
  const pageIds = deps.pageIds ?? present.workspaceOrder;
  const pick = deps.pick ?? 'all';
  const { snapshot, pages } = await composeSelectedPages(present, ink, pageIds, 'jpeg', deps);
  const width = snapshot.rasterWidth;
  const height = snapshot.rasterHeight;

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(pdfTitle(snapshot.name));
    pdfDoc.setCreator('MangaSketcher');
    pdfDoc.setProducer('MangaSketcher');
    pdfDoc.catalog.set(PDFName.of('PageLayout'), PDFName.of('SinglePage'));
    pdfDoc.catalog.getOrCreateViewerPreferences().setReadingDirection(ReadingDirection.R2L);

    const pageRefs: PDFRef[] = [];
    for (const page of pages) {
      const pdfPage = pdfDoc.addPage([width, height]);
      const image = await pdfDoc.embedJpg(page.bytes);
      pdfPage.drawImage(image, { x: 0, y: 0, width, height });
      pageRefs.push(pdfPage.ref);
    }

    addPageLabels(pdfDoc, pages[0]!.workspaceNumber);
    addOutlines(
      pdfDoc,
      pages.map((page, index) => ({
        title: String(page.workspaceNumber),
        pageRef: pageRefs[index]!,
      })),
    );
  } catch (err) {
    if (err instanceof WorkspaceExportError) {
      throw err;
    }
    throw new WorkspaceExportError();
  }

  const timestamp = formatExportTimestamp(deps.now ?? new Date());
  const stem = sanitizeExportStem(snapshot.name);
  const fileName = buildPageExportFileName({
    format: 'pdf',
    stem,
    timestamp,
    pick,
    count: pages.length,
    firstNumber: pages[0]!.workspaceNumber,
    lastNumber: pages[pages.length - 1]!.workspaceNumber,
  });
  const bytes = await pdfDoc.save();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'application/pdf' });
  return new File([blob], fileName, { type: 'application/pdf', lastModified: Date.now() });
}

function pdfTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? '無題' : trimmed;
}

function addPageLabels(pdfDoc: PDFDocument, firstWorkspaceNumber: number): void {
  const labels = pdfDoc.context.obj({
    Nums: [0, { S: 'D', St: firstWorkspaceNumber }],
  });
  pdfDoc.catalog.set(PDFName.of('PageLabels'), labels);
}

function addOutlines(
  pdfDoc: PDFDocument,
  items: readonly { title: string; pageRef: PDFRef }[],
): void {
  if (items.length === 0) {
    return;
  }
  const context = pdfDoc.context;
  const outlinesRef = context.nextRef();
  const itemRefs = items.map(() => context.nextRef());
  items.forEach((item, index) => {
    const dict = new Map();
    dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
    dict.set(PDFName.of('Parent'), outlinesRef);
    dict.set(PDFName.of('Dest'), context.obj([item.pageRef, PDFName.of('Fit')]));
    dict.set(PDFName.of('Count'), PDFNumber.of(0));
    if (index > 0) {
      dict.set(PDFName.of('Prev'), itemRefs[index - 1]);
    }
    if (index < items.length - 1) {
      dict.set(PDFName.of('Next'), itemRefs[index + 1]);
    }
    context.assign(itemRefs[index]!, PDFDict.fromMapWithContext(dict, context));
  });
  const outlinesDict = new Map();
  outlinesDict.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlinesDict.set(PDFName.of('First'), itemRefs[0]);
  outlinesDict.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1]);
  outlinesDict.set(PDFName.of('Count'), PDFNumber.of(items.length));
  context.assign(outlinesRef, PDFDict.fromMapWithContext(outlinesDict, context));
  pdfDoc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}
