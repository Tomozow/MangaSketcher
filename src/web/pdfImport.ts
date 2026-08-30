import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import { extractPdfSourceText } from '@/src/domain/pdfExtract';
import { pdfFileFingerprint } from '@/src/domain/pdfView';
import type { EditorDocument } from '@/src/storage/types';
import { writeProjectPdf } from '@/src/storage/projectStore';
import { dropPdfSession, getOrLoadPdfProxy } from '@/src/web/pdf/pdfSession';

export type PdfImportDeps = {
  projectId: string;
  getPresent: () => EditorDocument | undefined;
  checkpointBeforeHeavyWork: () => Promise<void>;
  setPdfBytes: (bytes: ArrayBuffer) => void;
  setPdfMissing: (missing: boolean) => void;
  dispatch: (action: EditorDocumentAction) => void;
};

export async function importProjectPdf(file: File, deps: PdfImportDeps): Promise<void> {
  await deps.checkpointBeforeHeavyWork();

  const present = deps.getPresent();
  if (!present) {
    return;
  }

  const buffer = await file.arrayBuffer();
  const owned = buffer.slice(0);
  const opfsPath = await writeProjectPdf(deps.projectId, owned.slice(0));
  const nextGeneration = (present.pdf?.generation ?? 0) + 1;
  if (present.pdf) {
    dropPdfSession(present.pdf.opfsPath, present.pdf.generation);
  }

  const extractBytes = new Uint8Array(owned.slice(0));
  const { pageCount, sourceTextByPage } = await extractPdfSourceText(extractBytes, (data) =>
    getOrLoadPdfProxy(opfsPath, nextGeneration, data),
  );

  deps.setPdfBytes(owned);
  deps.setPdfMissing(false);

  deps.dispatch({
    type: 'loadPdf',
    opfsPath,
    pageCount,
    sourceTextByPage,
    generation: nextGeneration,
    sourceFingerprint: pdfFileFingerprint(file),
  });
}
