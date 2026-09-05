import { isPngBuffer } from '@/src/web/ink/fakeCanvas';
import { collectRasterIds } from './rasterIds';
import type { EditorDocument, ProjectMeta } from './types';

export const DOCUMENT_SNAPSHOTS = 'documentSnapshots';
export const RASTER_SNAPSHOTS = 'rasterSnapshots';

export type CommitSnapshotMode = 'guarded' | 'none' | 'name-only';

export type CommitDocumentGenerationInput = {
  document: EditorDocument;
  meta: ProjectMeta;
  rasters?: ReadonlyMap<string, ArrayBuffer>;
  /** Default `guarded`. Restore writes live with `none`. rename uses `name-only`. */
  snapshot?: CommitSnapshotMode;
};

export type CommitDocumentGenerationResult = {
  snapshotUpdated: boolean;
};

/** 8-byte PNG signature. Do not use a 4-byte `89 50 4E 47` prefix check. */
export function storedPngIsValid(buffer: ArrayBuffer | undefined): boolean {
  return Boolean(buffer && isPngBuffer(buffer));
}

export function isQuotaExceededError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'QuotaExceededError' || err.code === 22;
  }
  return err instanceof Error && err.name === 'QuotaExceededError';
}

export function stripStoredDocument(stored: unknown): EditorDocument | undefined {
  if (!stored || typeof stored !== 'object') {
    return undefined;
  }
  const row = stored as EditorDocument & { id: string };
  const { id: _key, ...doc } = row;
  return { ...doc, projectId: row.id ?? doc.projectId } as EditorDocument;
}

export function rasterValueToArrayBuffer(value: unknown): ArrayBuffer | undefined {
  if (value == null) {
    return undefined;
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy.buffer;
  }
  if (typeof value === 'object' && value !== null && 'png' in value) {
    return rasterValueToArrayBuffer((value as { png: unknown }).png);
  }
  return undefined;
}

export async function rasterToArrayBuffer(value: unknown): Promise<ArrayBuffer | undefined> {
  if (value == null) {
    return undefined;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.arrayBuffer();
  }
  return rasterValueToArrayBuffer(value);
}

export async function rasterIdsHaveValidPng(
  ids: readonly string[],
  getPng: (rasterId: string) => Promise<ArrayBuffer | undefined>,
): Promise<boolean> {
  for (const rasterId of ids) {
    const png = await getPng(rasterId);
    if (!storedPngIsValid(png)) {
      return false;
    }
  }
  return true;
}

export async function documentLiveRastersAreValid(
  getRaster: (rasterId: string) => Promise<ArrayBuffer | undefined>,
  doc: EditorDocument,
): Promise<boolean> {
  return rasterIdsHaveValidPng(collectRasterIds(doc), getRaster);
}

export async function documentSnapshotRastersAreValid(
  getSnapshotRaster: (rasterId: string) => Promise<ArrayBuffer | undefined>,
  doc: EditorDocument,
): Promise<boolean> {
  return rasterIdsHaveValidPng(collectRasterIds(doc), getSnapshotRaster);
}

export function metaFromDocument(doc: EditorDocument, updatedAt: string): ProjectMeta {
  return {
    id: doc.projectId,
    name: doc.name,
    updatedAt,
    pageCount: Object.keys(doc.pages).length,
  };
}

/**
 * Snapshot guard: every collectRasterIds key must have a real PNG in this payload
 * (if present) or already in live. Invalid payload bytes fail the id (do not fall
 * back to live), so we never copy a torn encode onto snapshot.
 */
export function snapshotGuardPasses(
  doc: EditorDocument,
  payload: ReadonlyMap<string, ArrayBuffer>,
  liveBytes: ReadonlyMap<string, ArrayBuffer>,
): boolean {
  for (const rasterId of collectRasterIds(doc)) {
    if (payload.has(rasterId)) {
      if (!storedPngIsValid(payload.get(rasterId))) {
        return false;
      }
      continue;
    }
    if (!storedPngIsValid(liveBytes.get(rasterId))) {
      return false;
    }
  }
  return true;
}

/** Dirty payload PNGs plus live copies for snapshot keys that are still empty (lazy-fill). */
export function snapshotRastersToPut(
  doc: EditorDocument,
  payload: ReadonlyMap<string, ArrayBuffer>,
  liveBytes: ReadonlyMap<string, ArrayBuffer>,
  existingSnapshot: ReadonlyMap<string, ArrayBuffer>,
): Map<string, ArrayBuffer> {
  const toPut = new Map<string, ArrayBuffer>();
  for (const rasterId of collectRasterIds(doc)) {
    const fromPayload = payload.get(rasterId);
    if (fromPayload && storedPngIsValid(fromPayload)) {
      toPut.set(rasterId, fromPayload);
      continue;
    }
    if (existingSnapshot.has(rasterId)) {
      continue;
    }
    const fill = liveBytes.get(rasterId);
    if (fill && storedPngIsValid(fill)) {
      toPut.set(rasterId, fill);
    }
  }
  return toPut;
}
