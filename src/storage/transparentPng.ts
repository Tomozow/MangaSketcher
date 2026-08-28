import { DEFAULT_RASTER_HEIGHT, DEFAULT_RASTER_WIDTH } from './types';

let sharedTransparentPng: ArrayBuffer | null = null;

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** RFC 1950 wrapper around stored (uncompressed) deflate blocks. No Node `zlib`. */
function zlibStore(raw: Uint8Array): Uint8Array {
  const max = 65535;
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < raw.length; offset += max) {
    const len = Math.min(max, raw.length - offset);
    const last = offset + len >= raw.length ? 1 : 0;
    const block = new Uint8Array(5 + len);
    block[0] = last;
    block[1] = len & 0xff;
    block[2] = (len >> 8) & 0xff;
    const nlen = ~len & 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >> 8) & 0xff;
    block.set(raw.subarray(offset, offset + len), 5);
    blocks.push(block);
  }
  const bodyLen = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(2 + bodyLen + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let cursor = 2;
  for (const block of blocks) {
    out.set(block, cursor);
    cursor += block.length;
  }
  new DataView(out.buffer).setUint32(cursor, adler32(raw));
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i]!;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length);
  const combined = new Uint8Array(4 + 4 + data.length + 4);
  combined.set(length, 0);
  combined.set(typeBytes, 4);
  combined.set(data, 8);
  const crc = crc32(combined.subarray(4, 8 + data.length));
  new DataView(combined.buffer).setUint32(8 + data.length, crc);
  return combined;
}

function encodeTransparentPng(width: number, height: number): ArrayBuffer {
  const rowBytes = 1 + width * 4;
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0;
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlibStore(raw);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    signature,
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', idat),
    writeChunk('IEND', new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

async function encodeWithOffscreenCanvas(width: number, height: number): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2d context unavailable');
  }
  ctx.clearRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}

export async function ensureSharedTransparentPng(
  width = DEFAULT_RASTER_WIDTH,
  height = DEFAULT_RASTER_HEIGHT,
): Promise<void> {
  if (sharedTransparentPng) {
    return;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    sharedTransparentPng = await encodeWithOffscreenCanvas(width, height);
    return;
  }
  sharedTransparentPng = encodeTransparentPng(width, height);
}

export function copySharedTransparentPng(): ArrayBuffer {
  if (!sharedTransparentPng) {
    sharedTransparentPng = encodeTransparentPng(DEFAULT_RASTER_WIDTH, DEFAULT_RASTER_HEIGHT);
  }
  return sharedTransparentPng.slice(0);
}

export function resetSharedTransparentPngForTests(): void {
  sharedTransparentPng = null;
}
