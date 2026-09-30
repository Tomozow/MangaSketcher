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
  /** No longer used: the previous generation is always kept as the fallback. */
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

/** `getRaster` takes a raster id; the caller maps it to the store key of `doc`. */
export async function documentRastersAreValid(
  getRaster: (rasterId: string) => Promise<ArrayBuffer | undefined>,
  doc: EditorDocument,
): Promise<boolean> {
  return rasterIdsHaveValidPng(collectRasterIds(doc), getRaster);
}

export function metaFromDocument(doc: EditorDocument, updatedAt: string): ProjectMeta {
  return {
    id: doc.projectId,
    name: doc.name,
    updatedAt,
    pageCount: Object.keys(doc.pages).length,
  };
}

/** `rasters` store key of one revision. Revision 0 is the key used before revisions existed. */
export function rasterKey(rasterId: string, rev: number | undefined): string {
  return rev ? `${rasterId}@${rev}` : rasterId;
}

/** Key of the PNG a stored document uses for `rasterId`. Only valid for a document as read from storage. */
export function documentRasterKey(doc: EditorDocument, rasterId: string): string {
  return rasterKey(rasterId, doc.rasterRevs?.[rasterId]);
}

export function isRevisionedRasterKey(key: string): boolean {
  return key.includes('@');
}

export function documentRasterKeys(doc: EditorDocument): string[] {
  return collectRasterIds(doc).map((rasterId) => documentRasterKey(doc, rasterId));
}

export type GenerationPlan = {
  /** The new live document, stamped with its generation and raster revisions. */
  document: EditorDocument;
  /** The previous live document; it becomes the fallback generation. */
  snapshot: EditorDocument | undefined;
  /** New PNGs by store key. Revisions are never overwritten. */
  puts: Map<string, ArrayBuffer>;
  /** Revisions no longer used by the new or the fallback generation. */
  deletes: string[];
};

/**
 * One save = one new generation. Changed rasters get a new immutable key; the document that
 * references them is written in the same transaction; the previous document is kept as fallback.
 * `prev` / `prev2` are the stored live and fallback documents. Throws on a payload that is not a PNG,
 * so a bad encode can never become the saved state.
 */
export function planGeneration(
  prev: EditorDocument | undefined,
  prev2: EditorDocument | undefined,
  input: Pick<CommitDocumentGenerationInput, 'document' | 'rasters'>,
): GenerationPlan {
  const generation = (prev?.generation ?? 0) + 1;
  const prevRevs = prev?.rasterRevs ?? {};
  const rasterRevs: Record<string, number> = {};
  const puts = new Map<string, ArrayBuffer>();
  for (const rasterId of collectRasterIds(input.document)) {
    const png = input.rasters?.get(rasterId);
    if (png === undefined) {
      rasterRevs[rasterId] = prevRevs[rasterId] ?? 0;
      continue;
    }
    if (!storedPngIsValid(png)) {
      throw new Error(`raster ${rasterId} is not a PNG; generation not saved`);
    }
    rasterRevs[rasterId] = generation;
    puts.set(rasterKey(rasterId, generation), png);
  }
  const deletes: string[] = [];
  // Un-revisioned keys (rev 0) are never deleted here: they are the pre-migration data.
  for (const [rasterId, rev] of Object.entries(prev2?.rasterRevs ?? {})) {
    if (rev > 0 && prevRevs[rasterId] !== rev && rasterRevs[rasterId] !== rev) {
      deletes.push(rasterKey(rasterId, rev));
    }
  }
  return {
    document: { ...input.document, generation, rasterRevs },
    snapshot: prev ? { ...prev, generation: prev.generation ?? 0, rasterRevs: prevRevs } : undefined,
    puts,
    deletes,
  };
}
