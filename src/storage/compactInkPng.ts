import { unzlibSync, zlibSync } from 'fflate/browser';

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concatParts(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

function encodePng(samples: Uint8Array, width: number, height: number, colorType: 4 | 6): ArrayBuffer {
  const stride = colorType === 4 ? width * 2 : width * 4;
  if (samples.length !== stride * height) {
    throw new Error('PNG sample length does not match dimensions');
  }
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    const dest = y * (1 + stride);
    raw[dest] = 0;
    raw.set(samples.subarray(y * stride, y * stride + stride), dest + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const idat = zlibSync(raw, { level: 9 });
  const bytes = concatParts([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function encodeInkRgbaPng(rgba: Uint8Array, width: number, height: number): ArrayBuffer {
  return encodePng(rgba, width, height, 6);
}

export function encodeTransparentPngBytes(width: number, height: number): ArrayBuffer {
  return encodePng(new Uint8Array(width * height * 4), width, height, 6);
}

/** Builds the gray+alpha files briefly written by pack export; kept to repair those zips. */
export function encodeInkGrayAlphaPng(rgba: Uint8Array, width: number, height: number): ArrayBuffer {
  return encodePng(rgbaToGrayAlpha(rgba), width, height, 4);
}

export function pngColorType(png: ArrayBuffer): number | null {
  const bytes = new Uint8Array(png);
  if (bytes.length < 25 || PNG_SIG.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  if (view.getUint32(8) !== 13 || readChunkType(bytes, 12) !== 'IHDR') {
    return null;
  }
  return bytes[25] ?? null;
}

export type DecodedPngRgba = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

function readChunkType(png: Uint8Array, offset: number): string {
  return String.fromCharCode(png[offset]!, png[offset + 1]!, png[offset + 2]!, png[offset + 3]!);
}

function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  const samples = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + stride);
    const filter = raw[row]!;
    const dest = samples.subarray(y * stride, y * stride + stride);
    const prev = y === 0 ? null : samples.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x += 1) {
      const filt = raw[row + 1 + x]!;
      const left = x >= bpp ? dest[x - bpp]! : 0;
      const up = prev ? prev[x]! : 0;
      const upLeft = prev && x >= bpp ? prev[x - bpp]! : 0;
      let pred = 0;
      if (filter === 1) {
        pred = left;
      } else if (filter === 2) {
        pred = up;
      } else if (filter === 3) {
        pred = (left + up) >> 1;
      } else if (filter === 4) {
        pred = paethPredictor(left, up, upLeft);
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
      dest[x] = (filt + pred) & 255;
    }
  }
  return samples;
}

function samplesToRgba(
  samples: Uint8Array,
  width: number,
  height: number,
  colorType: number,
): Uint8Array {
  const count = width * height;
  if (colorType === 6) {
    return samples;
  }
  const rgba = new Uint8Array(count * 4);
  if (colorType === 4) {
    for (let i = 0, o = 0; i < samples.length; i += 2, o += 4) {
      const gray = samples[i]!;
      rgba[o] = gray;
      rgba[o + 1] = gray;
      rgba[o + 2] = gray;
      rgba[o + 3] = samples[i + 1]!;
    }
    return rgba;
  }
  if (colorType === 2) {
    for (let i = 0, o = 0; i < samples.length; i += 3, o += 4) {
      rgba[o] = samples[i]!;
      rgba[o + 1] = samples[i + 1]!;
      rgba[o + 2] = samples[i + 2]!;
      rgba[o + 3] = 255;
    }
    return rgba;
  }
  if (colorType === 0) {
    for (let i = 0, o = 0; i < samples.length; i += 1, o += 4) {
      const gray = samples[i]!;
      rgba[o] = gray;
      rgba[o + 1] = gray;
      rgba[o + 2] = gray;
      rgba[o + 3] = 255;
    }
    return rgba;
  }
  throw new Error(`unsupported PNG color type ${colorType}`);
}

export function tryDecodePngToRgba(png: ArrayBuffer): DecodedPngRgba | null {
  const bytes = new Uint8Array(png);
  if (bytes.length < 33 || PNG_SIG.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idatParts: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const length = view.getUint32(0);
    if (offset + 12 + length > bytes.length) {
      return null;
    }
    const type = readChunkType(bytes, offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      if (length < 13) {
        return null;
      }
      width = view.getUint32(8);
      height = view.getUint32(12);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (
    width < 1 ||
    height < 1 ||
    width > 32767 ||
    height > 32767 ||
    bitDepth !== 8 ||
    interlace !== 0 ||
    (colorType !== 0 && colorType !== 2 && colorType !== 4 && colorType !== 6)
  ) {
    return null;
  }
  const idatLen = idatParts.reduce((sum, part) => sum + part.length, 0);
  if (idatLen === 0) {
    return null;
  }
  const idat = new Uint8Array(idatLen);
  let writeAt = 0;
  for (const part of idatParts) {
    idat.set(part, writeAt);
    writeAt += part.length;
  }
  let raw: Uint8Array;
  try {
    raw = unzlibSync(idat);
  } catch {
    return null;
  }
  const stride = colorType === 6 ? width * 4 : colorType === 4 ? width * 2 : colorType === 2 ? width * 3 : width;
  const bpp = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  if (raw.length !== height * (1 + stride)) {
    return null;
  }
  try {
    const samples = unfilter(raw, height, stride, bpp);
    return { width, height, rgba: samplesToRgba(samples, width, height, colorType) };
  } catch {
    return null;
  }
}

function zeroInvisibleRgb(rgba: Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) {
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
    }
  }
}

function isFullyTransparent(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 0) {
      return false;
    }
  }
  return true;
}

function rgbaToGrayAlpha(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 2);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
    out[o] = rgba[i]!;
    out[o + 1] = rgba[i + 3]!;
  }
  return out;
}

function rgbaEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function encodeCompactInkPng(rgba: Uint8Array, width: number, height: number): ArrayBuffer {
  if (isFullyTransparent(rgba)) {
    return encodeTransparentPngBytes(width, height);
  }
  return encodeInkRgbaPng(rgba, width, height);
}

function encodeVerifiedRgbaPng(rgba: Uint8Array, width: number, height: number): ArrayBuffer | null {
  const encoded = encodeCompactInkPng(rgba, width, height);
  const check = tryDecodePngToRgba(encoded);
  if (!check || check.width !== width || check.height !== height || !rgbaEqual(check.rgba, rgba)) {
    return null;
  }
  if (pngColorType(encoded) !== 6) {
    return null;
  }
  return encoded;
}

/**
 * Repair gray+alpha (type 4) packs that Safari/Chrome createImageBitmap washes out.
 * Drawn RGBA (type 6) bytes are left untouched so ink resolution stays native.
 */
export function normalizePackRasterPng(png: ArrayBuffer): ArrayBuffer {
  const colorType = pngColorType(png);
  if (colorType === 4 || colorType === 0 || colorType === 2) {
    const decoded = tryDecodePngToRgba(png);
    if (!decoded) {
      return png;
    }
    zeroInvisibleRgb(decoded.rgba);
    return encodeVerifiedRgbaPng(decoded.rgba, decoded.width, decoded.height) ?? png;
  }
  return compactPackRasterPng(png);
}

/** Replace fully transparent rasters only. Drawn ink PNGs pass through. */
export function compactPackRasterPng(png: ArrayBuffer): ArrayBuffer {
  const decoded = tryDecodePngToRgba(png);
  if (!decoded || !isFullyTransparent(decoded.rgba)) {
    return png;
  }
  const empty = encodeTransparentPngBytes(decoded.width, decoded.height);
  return empty.byteLength < png.byteLength ? empty : png;
}
