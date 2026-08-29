import { clampPdfPage } from '../domain/pdfView';
import type { EditorDocument } from './types';

export const PDF_VIEW_SESSION_STORAGE_KEY = 'mangasketcher:pdf-view-by-project';

export type PdfViewSession = {
  currentPage: number;
  zoom: number;
  panX: number;
  panY: number;
  fingerprint?: string;
};

function readLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function parseSessions(raw: unknown): Record<string, PdfViewSession> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, PdfViewSession> = {};
  for (const [projectId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!projectId || !value || typeof value !== 'object') {
      continue;
    }
    const row = value as Partial<PdfViewSession>;
    const currentPage = Number(row.currentPage);
    const zoom = Number(row.zoom);
    const panX = Number(row.panX);
    const panY = Number(row.panY);
    if (!Number.isFinite(currentPage) || !Number.isFinite(zoom) || !Number.isFinite(panX) || !Number.isFinite(panY)) {
      continue;
    }
    out[projectId] = {
      currentPage,
      zoom,
      panX,
      panY,
      fingerprint: typeof row.fingerprint === 'string' ? row.fingerprint : undefined,
    };
  }
  return out;
}

export function loadPdfViewSessions(): Record<string, PdfViewSession> {
  const storage = readLocalStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(PDF_VIEW_SESSION_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return parseSessions(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export function loadPdfViewSession(projectId: string): PdfViewSession | null {
  return loadPdfViewSessions()[projectId] ?? null;
}

export function savePdfViewSession(projectId: string, session: PdfViewSession): void {
  const storage = readLocalStorage();
  const next = { ...loadPdfViewSessions(), [projectId]: session };
  try {
    storage?.setItem(PDF_VIEW_SESSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: in-memory last view is still in the open document.
  }
}

export function applyPdfViewSession(doc: EditorDocument, session: PdfViewSession | null): EditorDocument {
  if (!doc.pdf || !session) {
    return doc;
  }
  if (
    session.fingerprint &&
    doc.pdf.sourceFingerprint &&
    session.fingerprint !== doc.pdf.sourceFingerprint
  ) {
    return doc;
  }
  return {
    ...doc,
    pdf: {
      ...doc.pdf,
      currentPage: clampPdfPage(session.currentPage, doc.pdf.pageCount),
      zoom: session.zoom,
      panX: session.panX,
      panY: session.panY,
    },
  };
}
