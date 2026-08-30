/**
 * CSFCHUNK container I/O for Clip Studio Paint .clip files.
 * Browser-compatible: Uint8Array / DataView only (no Node Buffer or fs).
 */

export const CSFCHUNK_MAGIC_BYTES = new Uint8Array([
  0x43, 0x53, 0x46, 0x43, 0x48, 0x55, 0x4e, 0x4b,
]); // "CSFCHUNK"
export const SQLITE_MAGIC_BYTES = new Uint8Array([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);
export const HEADER_SIZE = 24;
export const CHUNK_NAME_SIZE = 8;
export const CHUNK_HEADER_SIZE = 16;
export const HEAD_PAYLOAD_SIZE = 40;

export class ClipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipFormatError';
  }
}

export interface ClipChunk {
  name: string;
  headerOffset: number;
  dataOffset: number;
  length: number;
  payload: Uint8Array;
}

export interface ClipHeadFields {
  constant256: number;
  sqliDataOffset: number;
  constant16: number;
  documentUuid: Uint8Array;
}

export interface ClipExta {
  externalId: string;
  body: Uint8Array;
}

export interface ParsedClip {
  fileSizeField: number;
  firstChunkOffset: number;
  chunks: ClipChunk[];
  head: ClipHeadFields;
  extas: ClipExta[];
  sqliteBytes: Uint8Array;
}

function readU64BE(view: DataView, offset: number): number {
  const hi = view.getUint32(offset);
  const lo = view.getUint32(offset + 4);
  return hi * 0x100000000 + lo;
}

function writeU64BE(view: DataView, offset: number, value: number): void {
  const hi = Math.floor(value / 0x100000000);
  const lo = value % 0x100000000;
  view.setUint32(offset, hi);
  view.setUint32(offset + 4, lo);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function decodeAscii(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  return s;
}

function encodeAscii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i);
  }
  return out;
}

export function parseExtaPayload(payload: Uint8Array): { externalId: string; body: Uint8Array } {
  if (payload.length < 16) {
    throw new ClipFormatError('CHNKExta payload too short');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const idLen = readU64BE(view, 0);
  if (8 + idLen + 8 > payload.length) {
    throw new ClipFormatError('CHNKExta identifier overruns payload');
  }
  const eid = decodeAscii(payload.subarray(8, 8 + idLen));
  const bodyLen = readU64BE(view, 8 + idLen);
  const bodyOff = 16 + idLen;
  if (bodyOff + bodyLen > payload.length) {
    throw new ClipFormatError(`CHNKExta body overruns payload for ${eid}`);
  }
  return { externalId: eid, body: payload.subarray(bodyOff, bodyOff + bodyLen) };
}

export function buildExtaPayload(externalId: string, body: Uint8Array): Uint8Array {
  const eidBytes = encodeAscii(externalId);
  const total = 8 + eidBytes.length + 8 + body.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  writeU64BE(view, 0, eidBytes.length);
  out.set(eidBytes, 8);
  writeU64BE(view, 8 + eidBytes.length, body.length);
  out.set(body, 16 + eidBytes.length);
  return out;
}

export function parseHeadPayload(payload: Uint8Array): ClipHeadFields {
  if (payload.length < HEAD_PAYLOAD_SIZE) {
    throw new ClipFormatError('CHNKHead too short');
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    constant256: readU64BE(view, 0),
    sqliDataOffset: readU64BE(view, 8),
    constant16: readU64BE(view, 16),
    documentUuid: payload.subarray(24, 40),
  };
}

export function buildHeadPayload(fields: ClipHeadFields): Uint8Array {
  const out = new Uint8Array(HEAD_PAYLOAD_SIZE);
  const view = new DataView(out.buffer);
  writeU64BE(view, 0, fields.constant256);
  writeU64BE(view, 8, fields.sqliDataOffset);
  writeU64BE(view, 16, fields.constant16);
  out.set(fields.documentUuid, 24);
  return out;
}

export function parseClip(bytes: Uint8Array): ParsedClip {
  if (bytes.length < HEADER_SIZE) {
    throw new ClipFormatError(`File too short (${bytes.length} bytes)`);
  }
  if (!bytesEqual(bytes.subarray(0, 8), CSFCHUNK_MAGIC_BYTES)) {
    throw new ClipFormatError(`Not a CLIP file: magic=${decodeAscii(bytes.subarray(0, 8))}`);
  }

  const headerView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileSizeField = readU64BE(headerView, 8);
  const firstChunkOffset = readU64BE(headerView, 16);

  const chunks: ClipChunk[] = [];
  let off = firstChunkOffset;
  const n = bytes.length;

  while (off < n) {
    if (off + CHUNK_HEADER_SIZE > n) {
      throw new ClipFormatError(`Truncated chunk header at ${off}`);
    }
    const nameBytes = bytes.subarray(off, off + CHUNK_NAME_SIZE);
    const name = decodeAscii(nameBytes);
    const length = readU64BE(headerView, off + 8);
    const dataOffset = off + CHUNK_HEADER_SIZE;
    if (dataOffset + length > n) {
      throw new ClipFormatError(
        `Chunk ${name} at ${off} claims length ${length} but only ${n - dataOffset} bytes remain`,
      );
    }
    chunks.push({
      name,
      headerOffset: off,
      dataOffset,
      length,
      payload: bytes.subarray(dataOffset, dataOffset + length),
    });
    off = dataOffset + length;
  }

  const headChunk = chunks.find((c) => c.name === 'CHNKHead');
  const sqliChunk = chunks.find((c) => c.name === 'CHNKSQLi');
  if (!headChunk) throw new ClipFormatError('Missing CHNKHead');
  if (!sqliChunk) throw new ClipFormatError('Missing CHNKSQLi');

  const head = parseHeadPayload(headChunk.payload);
  const extas: ClipExta[] = [];
  for (const c of chunks) {
    if (c.name !== 'CHNKExta') continue;
    const { externalId, body } = parseExtaPayload(c.payload);
    extas.push({ externalId, body });
  }

  const sqliteBytes = sqliChunk.payload;
  if (!bytesEqual(sqliteBytes.subarray(0, 16), SQLITE_MAGIC_BYTES)) {
    throw new ClipFormatError('CHNKSQLi is not a SQLite database');
  }

  return {
    fileSizeField,
    firstChunkOffset,
    chunks,
    head,
    extas,
    sqliteBytes,
  };
}

/** Compute file-absolute offsets for each Exta chunk header (CHNKExta name field offset). */
export function computeExtaHeaderOffsets(extas: ClipExta[]): Map<string, number> {
  const offsets = new Map<string, number>();
  let pos = HEADER_SIZE;
  pos += CHUNK_HEADER_SIZE + HEAD_PAYLOAD_SIZE;

  for (const exta of extas) {
    offsets.set(exta.externalId, pos);
    const payload = buildExtaPayload(exta.externalId, exta.body);
    pos += CHUNK_HEADER_SIZE + payload.length;
  }
  return offsets;
}

export interface BuildClipOptions {
  extas: ClipExta[];
  head: ClipHeadFields;
  sqliteBytes: Uint8Array;
}

export function buildClip(options: BuildClipOptions): Uint8Array {
  const { extas, head, sqliteBytes } = options;

  const extaPayloads: { externalId: string; payload: Uint8Array }[] = [];
  for (const exta of extas) {
    extaPayloads.push({
      externalId: exta.externalId,
      payload: buildExtaPayload(exta.externalId, exta.body),
    });
  }

  let pos = HEADER_SIZE;
  pos += CHUNK_HEADER_SIZE + HEAD_PAYLOAD_SIZE;

  for (const { payload } of extaPayloads) {
    pos += CHUNK_HEADER_SIZE + payload.length;
  }

  const sqliteHeaderOffset = pos;
  const total =
    HEADER_SIZE +
    CHUNK_HEADER_SIZE +
    HEAD_PAYLOAD_SIZE +
    extaPayloads.reduce((sum, e) => sum + CHUNK_HEADER_SIZE + e.payload.length, 0) +
    CHUNK_HEADER_SIZE +
    sqliteBytes.length +
    CHUNK_HEADER_SIZE;

  const headFields: ClipHeadFields = {
    constant256: head.constant256,
    sqliDataOffset: sqliteHeaderOffset,
    constant16: head.constant16,
    documentUuid: head.documentUuid,
  };
  const headPayload = buildHeadPayload(headFields);

  const parts: Uint8Array[] = [];
  const pushAscii = (s: string) => parts.push(encodeAscii(s));

  parts.push(CSFCHUNK_MAGIC_BYTES);
  const sizeBuf = new Uint8Array(16);
  const sizeView = new DataView(sizeBuf.buffer);
  writeU64BE(sizeView, 0, total);
  writeU64BE(sizeView, 8, HEADER_SIZE);
  parts.push(sizeBuf);

  pushAscii('CHNKHead');
  const headLenBuf = new Uint8Array(8);
  writeU64BE(new DataView(headLenBuf.buffer), 0, headPayload.length);
  parts.push(headLenBuf);
  parts.push(headPayload);

  for (const { payload } of extaPayloads) {
    pushAscii('CHNKExta');
    const lenBuf = new Uint8Array(8);
    writeU64BE(new DataView(lenBuf.buffer), 0, payload.length);
    parts.push(lenBuf);
    parts.push(payload);
  }

  pushAscii('CHNKSQLi');
  const sqlLenBuf = new Uint8Array(8);
  writeU64BE(new DataView(sqlLenBuf.buffer), 0, sqliteBytes.length);
  parts.push(sqlLenBuf);
  parts.push(sqliteBytes);

  pushAscii('CHNKFoot');
  parts.push(new Uint8Array(8)); // length 0

  const outLen = parts.reduce((sum, p) => sum + p.length, 0);
  if (outLen !== total) {
    throw new ClipFormatError(`Size mismatch: built ${outLen} expected ${total}`);
  }

  const out = new Uint8Array(outLen);
  let writeOff = 0;
  for (const p of parts) {
    out.set(p, writeOff);
    writeOff += p.length;
  }
  return out;
}

/** Rebuild from ParsedClip, optionally substituting SQLite bytes. Preserves UUID, Exta order/bodies. */
export function rebuildClip(parsed: ParsedClip, sqliteBytes?: Uint8Array): Uint8Array {
  return buildClip({
    extas: parsed.extas,
    head: parsed.head,
    sqliteBytes: sqliteBytes ?? parsed.sqliteBytes,
  });
}
