/**
 * Browser-safe SQLite/Exta helpers for the .clip export pipeline.
 * Ports of tools/clip-experiments/dbHelpers.ts and tools/clip-template/helpers.ts
 * (browser code must not import from tools/).
 */
import type { Database } from 'sql.js';
import { computeExtaHeaderOffsets, type ClipExta } from './container';
import { encodeColorOffscreen, rebuildAttribute } from './raster';

/** Sync ExternalChunk offsets to the CHNKExta layout that rebuildClip will emit. */
export function rebuildExternalChunk(db: Database, extas: ClipExta[]): void {
  const offsets = computeExtaHeaderOffsets(extas);
  db.run('DELETE FROM ExternalChunk');
  for (const [externalId, offset] of offsets) {
    db.run('INSERT INTO ExternalChunk(ExternalID, Offset) VALUES (?, ?)', [externalId, offset]);
  }
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
  if (!(bd instanceof Uint8Array)) {
    return null;
  }
  return new TextDecoder('ascii').decode(bd).replace(/\0/g, '');
}

export function replaceExtaBody(
  extas: ClipExta[],
  externalId: string,
  newBody: Uint8Array,
): ClipExta[] {
  return extas.map((e) => (e.externalId === externalId ? { externalId, body: newBody } : e));
}

/** Re-encode an Offscreen's tiles from RGBA and swap its CHNKExta body (E5 flow). */
export function replaceOffscreenRgba(
  db: Database,
  offscreenMainId: number,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  extas: ClipExta[],
): ClipExta[] {
  const oldAttr = readOffscreenAttribute(db, offscreenMainId);
  if (!oldAttr) {
    throw new Error(`Offscreen MainId=${offscreenMainId} Attribute missing`);
  }
  const externalId = getOffscreenExternalId(db, offscreenMainId);
  if (!externalId) {
    throw new Error(`Offscreen MainId=${offscreenMainId} external id missing`);
  }

  const encoded = encodeColorOffscreen(rgba, width, height);
  const newAttr = rebuildAttribute(
    oldAttr,
    width,
    height,
    encoded.gridW,
    encoded.gridH,
    encoded.blockSizes,
  );
  writeOffscreenAttribute(db, offscreenMainId, newAttr);
  return replaceExtaBody(extas, externalId, encoded.blockDataBody);
}
