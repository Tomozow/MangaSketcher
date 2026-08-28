import { OPFS_PDF_DIR } from './types';
import type { EditorDocument, ProjectId } from './types';

export function pageRasterId(projectId: ProjectId, pageId: string): string {
  return `${projectId}:page:${pageId}`;
}

export function clipRasterId(projectId: ProjectId, clipId: string): string {
  return `${projectId}:clip:${clipId}`;
}

export function pdfOpfsPath(projectId: ProjectId): string {
  return `${OPFS_PDF_DIR}/${projectId}.pdf`;
}

export function collectRasterIds(doc: EditorDocument): string[] {
  const ids: string[] = [];
  for (const page of Object.values(doc.pages)) {
    ids.push(page.rasterId);
  }
  for (const clip of doc.pasteboardClips) {
    ids.push(clip.rasterId);
  }
  return ids;
}

export function rasterBelongsToProject(rasterId: string, projectId: ProjectId): boolean {
  return rasterId.startsWith(`${projectId}:`);
}
