import type { Database } from 'sql.js';
import {
  computeExtaHeaderOffsets,
  type ClipExta,
  type ParsedClip,
} from '../../src/web/export/clip/container';

export interface DbSnapshot {
  pageSize: number | null;
  encoding: string | null;
  integrityCheck: string;
  schemaTables: string[];
}

export function snapshotDb(db: Database): DbSnapshot {
  const pageSize = db.exec('PRAGMA page_size')[0]?.values[0]?.[0] as number | undefined;
  const encoding = db.exec('PRAGMA encoding')[0]?.values[0]?.[0] as string | undefined;
  const integrity = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] as string;
  const tables = db
    .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .flatMap((r) => r.values.map((row) => String(row[0])));

  return {
    pageSize: pageSize ?? null,
    encoding: encoding ?? null,
    integrityCheck: integrity,
    schemaTables: tables,
  };
}

export function diffSnapshots(before: DbSnapshot, after: DbSnapshot): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  if (before.pageSize !== after.pageSize) {
    diff.pageSize = { before: before.pageSize, after: after.pageSize };
  }
  if (before.encoding !== after.encoding) {
    diff.encoding = { before: before.encoding, after: after.encoding };
  }
  if (before.integrityCheck !== after.integrityCheck) {
    diff.integrityCheck = { before: before.integrityCheck, after: after.integrityCheck };
  }
  const beforeSet = new Set(before.schemaTables);
  const afterSet = new Set(after.schemaTables);
  const added = after.schemaTables.filter((t) => !beforeSet.has(t));
  const removed = before.schemaTables.filter((t) => !afterSet.has(t));
  if (added.length || removed.length) {
    diff.schema = { added, removed };
  }
  return diff;
}

export function rebuildExternalChunk(db: Database, extas: ClipExta[]): void {
  const offsets = computeExtaHeaderOffsets(extas);
  db.run('DELETE FROM ExternalChunk');
  for (const [externalId, offset] of offsets) {
    db.run('INSERT INTO ExternalChunk(ExternalID, Offset) VALUES (?, ?)', [externalId, offset]);
  }
}

export function updateTextLayerString(db: Database, mainId: number, text: string): void {
  const blob = new TextEncoder().encode(text);
  db.run('UPDATE Layer SET TextLayerString = ? WHERE MainId = ?', [blob, mainId]);
}

export interface TextLayerBlobs {
  attributes: Uint8Array;
  addAttributes: Uint8Array;
}

export function readTextLayerBlobs(db: Database, mainId: number): TextLayerBlobs | null {
  const stmt = db.prepare(
    'SELECT TextLayerAttributes, TextLayerAddAttributesV01 FROM Layer WHERE MainId = ?',
  );
  stmt.bind([mainId]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.get();
  stmt.free();
  const attrs = row[0];
  const add = row[1];
  if (!(attrs instanceof Uint8Array) || !(add instanceof Uint8Array)) {
    return null;
  }
  return { attributes: attrs, addAttributes: add };
}

export function writeTextLayerBlobs(
  db: Database,
  mainId: number,
  blobs: TextLayerBlobs,
): void {
  db.run(
    'UPDATE Layer SET TextLayerAttributes = ?, TextLayerAddAttributesV01 = ? WHERE MainId = ?',
    [blobs.attributes, blobs.addAttributes, mainId],
  );
}

/** Decode ASCII external id stored in Offscreen.BlockData (40-byte field). */
export function offscreenBlockDataToExternalId(blockData: Uint8Array): string {
  return new TextDecoder('ascii').decode(blockData).replace(/\0/g, '');
}

export function readOffscreenAttribute(db: Database, offscreenMainId: number): Uint8Array | null {
  const stmt = db.prepare('SELECT Attribute FROM Offscreen WHERE MainId = ?');
  stmt.bind([offscreenMainId]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.get();
  stmt.free();
  const attr = row[0];
  return attr instanceof Uint8Array ? attr : null;
}

export function writeOffscreenAttribute(
  db: Database,
  offscreenMainId: number,
  attribute: Uint8Array,
): void {
  db.run('UPDATE Offscreen SET Attribute = ? WHERE MainId = ?', [attribute, offscreenMainId]);
}

export function replaceExtaBody(
  extas: ClipExta[],
  externalId: string,
  newBody: Uint8Array,
): ClipExta[] {
  return extas.map((e) =>
    e.externalId === externalId ? { externalId, body: newBody } : e,
  );
}

export function getOffscreenExternalId(db: Database, offscreenMainId: number): string | null {
  const stmt = db.prepare('SELECT BlockData FROM Offscreen WHERE MainId = ?');
  stmt.bind([offscreenMainId]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.get();
  stmt.free();
  const bd = row[0];
  if (!(bd instanceof Uint8Array)) return null;
  return offscreenBlockDataToExternalId(bd);
}

/** Remove Offscreen row and matching CHNKExta from parsed clip extas list. */
export function removeOffscreenFloatCache(
  db: Database,
  parsed: ParsedClip,
  offscreenMainId: number,
): ClipExta[] {
  const externalId = getOffscreenExternalId(db, offscreenMainId);
  db.run('DELETE FROM Offscreen WHERE MainId = ?', [offscreenMainId]);
  if (!externalId) {
    return parsed.extas;
  }
  return parsed.extas.filter((e) => e.externalId !== externalId);
}
