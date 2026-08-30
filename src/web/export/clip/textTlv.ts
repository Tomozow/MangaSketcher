/**
 * Text layer TLV parse/serialize/patch for Clip Studio Paint .clip SQLite blobs.
 * Browser-compatible: Uint8Array / DataView only.
 */

export const FONT_SIZE_SCALE = 49.625;
export const MM_PER_PT = 2.8346457;
/** L5 @ 8pt vertical column width and line pitch (px); scales linearly with font size. */
export const COLUMN_WIDTH_8PT_PX = 33;
export const LINE_PITCH_8PT_PX = 33;
/**
 * Prototype L7 行間 at 8pt ((204−33)/3). Tighter than CSP's default after a
 * font-size change; bbox width uses 2× glyph column instead (see
 * verticalTextMetrics). Kept for documentation / sample comparison.
 */
export const INTER_COLUMN_PITCH_8PT_PX = 57;
/** L6 two-line width correction: +1px (was 91 = 33 + 57 + 1 @ 8pt). */
export const TWO_LINE_WIDTH_ADJ_8PT_PX = 1;
/** Multi-line bbox height padding (not scaled; L6/L7 and CSP usersave use +2). */
export const MULTI_LINE_HEIGHT_PAD_8PT_PX = 2;
export const BASE_FONT_SIZE_PT = 8;

/** Run-array TLV ids (full form in Attributes, compact in AddAttributes). */
export const RUN_ARRAY_IDS = new Set([11, 12, 13, 18, 26, 29, 30, 65]);

export class TextTlvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextTlvError';
  }
}

export interface TlvEntry {
  paramId: number;
  payload: Uint8Array;
}

export interface TextLayerAttributesBlob {
  entries: TlvEntry[];
}

export interface TextLayerAddAttributesBlob {
  /** Header u32 = blob length − 4 */
  header: number;
  entries: TlvEntry[];
}

export interface CanvasBBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RenderSize {
  width: number;
  height: number;
}

export interface TextLayerPatch {
  /** New UTF-16 code-unit count (updates run vtypes and id=39). */
  charCount?: number;
  /** Canvas-absolute bbox (id=42) plus derived id=63/64/72. */
  bbox?: CanvasBBox;
  /** Translate id=42 by delta without changing size. */
  positionDelta?: { x: number; y: number };
  /** Font size in typographic points (updates id=32 and id=13 f64[0]). */
  fontSizePt?: number;
  /** Scale bbox width/height by this factor (used with fontSizePt). */
  bboxScale?: number;
  /** Offscreen MainId reference (id=50); set 0 to drop float cache. */
  floatCacheOffscreenId?: number;
  /** Multi-line vertical text (affects id=64 variant and id=72 width−1). */
  multiLine?: boolean;
}

function readU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, value, true);
}

function readI32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(offset, true);
}

function writeI32(data: Uint8Array, offset: number, value: number): void {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setInt32(offset, value, true);
}

/** UTF-16 code-unit count (BMP + surrogate pairs). */
export function utf16CharCount(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    count++;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      i++;
    }
  }
  return count;
}

export function parseTlvStream(
  data: Uint8Array,
  start = 0,
): { entries: TlvEntry[]; consumed: number; trailing: Uint8Array } {
  const entries: TlvEntry[] = [];
  let off = start;
  const n = data.length;
  while (off + 8 <= n) {
    const paramId = readU32(data, off);
    const plen = readU32(data, off + 4);
    if (plen > n - off - 8) {
      return { entries, consumed: off - start, trailing: data.subarray(off) };
    }
    entries.push({
      paramId,
      payload: data.slice(off + 8, off + 8 + plen),
    });
    off += 8 + plen;
  }
  return { entries, consumed: off - start, trailing: data.subarray(off) };
}

export function serializeTlvStream(entries: TlvEntry[]): Uint8Array {
  let total = 0;
  for (const e of entries) {
    total += 8 + e.payload.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const e of entries) {
    writeU32(out, off, e.paramId);
    writeU32(out, off + 4, e.payload.length);
    off += 8;
    out.set(e.payload, off);
    off += e.payload.length;
  }
  return out;
}

export function parseTextLayerAttributes(data: Uint8Array): TextLayerAttributesBlob {
  const { entries, trailing } = parseTlvStream(data, 0);
  if (trailing.length > 0) {
    throw new TextTlvError(`TextLayerAttributes has ${trailing.length} trailing bytes`);
  }
  return { entries };
}

export function serializeTextLayerAttributes(blob: TextLayerAttributesBlob): Uint8Array {
  return serializeTlvStream(blob.entries);
}

export function parseTextLayerAddAttributes(data: Uint8Array): TextLayerAddAttributesBlob {
  if (data.length < 4) {
    throw new TextTlvError('TextLayerAddAttributesV01 too short');
  }
  const header = readU32(data, 0);
  const { entries, trailing } = parseTlvStream(data, 4);
  if (trailing.length > 0) {
    throw new TextTlvError(`TextLayerAddAttributesV01 has ${trailing.length} trailing bytes`);
  }
  const expectedHeader = data.length - 4;
  if (header !== expectedHeader) {
    throw new TextTlvError(
      `Add header ${header} != len-4 (${expectedHeader})`,
    );
  }
  return { header, entries };
}

export function serializeTextLayerAddAttributes(blob: TextLayerAddAttributesBlob): Uint8Array {
  const body = serializeTlvStream(blob.entries);
  const out = new Uint8Array(4 + body.length);
  writeU32(out, 0, body.length);
  out.set(body, 4);
  return out;
}

export function findTlvEntry(entries: TlvEntry[], paramId: number): TlvEntry | undefined {
  return entries.find((e) => e.paramId === paramId);
}

export function getTlvPayload(entries: TlvEntry[], paramId: number): Uint8Array | undefined {
  return findTlvEntry(entries, paramId)?.payload;
}

function cloneEntries(entries: TlvEntry[]): TlvEntry[] {
  return entries.map((e) => ({
    paramId: e.paramId,
    payload: new Uint8Array(e.payload),
  }));
}

function setTlvPayload(entries: TlvEntry[], paramId: number, payload: Uint8Array): void {
  const entry = findTlvEntry(entries, paramId);
  if (!entry) {
    throw new TextTlvError(`TLV id=${paramId} not found`);
  }
  entry.payload = payload;
}

/** Patch vtype (3rd u32) in a full-form run-array payload. */
export function patchFullRunVtype(payload: Uint8Array, charCount: number): Uint8Array {
  const out = new Uint8Array(payload);
  if (out.length >= 12) {
    writeU32(out, 8, charCount);
  }
  return out;
}

/** Patch id=39 UTF-16 char count (u64 low word). */
export function patchCharCountId39(payload: Uint8Array, charCount: number): Uint8Array {
  const out = new Uint8Array(payload);
  writeU32(out, 0, charCount);
  if (out.length >= 8) {
    writeU32(out, 4, 0);
  }
  return out;
}

export function readCanvasBBox(payload: Uint8Array): CanvasBBox {
  if (payload.length < 16) {
    throw new TextTlvError('id=42 payload too short');
  }
  return {
    left: readU32(payload, 0),
    top: readU32(payload, 4),
    right: readU32(payload, 8),
    bottom: readU32(payload, 12),
  };
}

export function encodeCanvasBBox(bbox: CanvasBBox): Uint8Array {
  const out = new Uint8Array(16);
  writeU32(out, 0, bbox.left);
  writeU32(out, 4, bbox.top);
  writeU32(out, 8, bbox.right);
  writeU32(out, 12, bbox.bottom);
  return out;
}

export function readRenderSize(payload: Uint8Array): RenderSize {
  if (payload.length < 8) {
    throw new TextTlvError('id=63 payload too short');
  }
  return {
    width: readU32(payload, 0),
    height: readU32(payload, 4),
  };
}

export function encodeRenderSize(size: RenderSize): Uint8Array {
  const out = new Uint8Array(8);
  writeU32(out, 0, size.width);
  writeU32(out, 4, size.height);
  return out;
}

/**
 * L5-style centi-px rect: [-w×100, 0, 0, 0, 0, h×100, -w×100, h×100].
 * L6/L7 use 100 at indices 2 and 4; pass variant='offset' for those layers.
 * Multi-line callers pass width−1 (prototype L6 −9000 for 91px).
 */
export function encodeRenderRectCentiPx(
  width: number,
  height: number,
  variant: 'simple' | 'offset' = 'simple',
): Uint8Array {
  const out = new Uint8Array(32);
  const w100 = -width * 100;
  const h100 = height * 100;
  writeI32(out, 0, w100);
  writeI32(out, 4, 0);
  if (variant === 'offset') {
    writeI32(out, 8, 100);
    writeI32(out, 12, 0);
    writeI32(out, 16, 100);
  } else {
    writeI32(out, 8, 0);
    writeI32(out, 12, 0);
    writeI32(out, 16, 0);
  }
  writeI32(out, 20, h100);
  writeI32(out, 24, w100);
  writeI32(out, 28, h100);
  return out;
}

export function encodeCacheWidthHint(width: number, multiLine = false): Uint8Array {
  const out = new Uint8Array(8);
  writeU32(out, 0, multiLine ? width - 1 : width);
  writeU32(out, 4, 0);
  return out;
}

/** Split on explicit CRLF line breaks (CSP text layers). */
export function splitExplicitLines(text: string): string[] {
  if (text.includes('\r\n')) {
    return text.split('\r\n');
  }
  if (text.includes('\n')) {
    return text.split('\n');
  }
  return [text];
}

export function explicitLineCount(text: string): number {
  return splitExplicitLines(text).length;
}

export function hasExplicitLineBreaks(text: string): boolean {
  return text.includes('\r\n') || text.includes('\n');
}

export function lineUtf16CharCounts(text: string): number[] {
  return splitExplicitLines(text).map((line) => utf16CharCount(line));
}

export function maxLineUtf16CharCount(text: string): number {
  const counts = lineUtf16CharCounts(text);
  return counts.length ? Math.max(...counts) : 0;
}

export interface VerticalTextMetrics {
  fontSizePt: number;
  glyphColumnWidth: number;
  linePitchPx: number;
  interColumnPitchPx: number;
  lineCount: number;
  maxLineChars: number;
  width: number;
  height: number;
  multiLine: boolean;
}

/** Compute vertical-text layout metrics (single- or multi-line). */
export function verticalTextMetrics(text: string, fontSizeValue: number): VerticalTextMetrics {
  const fontSizePt = fontSizeValue / FONT_SIZE_SCALE;
  const scale = fontSizePt / BASE_FONT_SIZE_PT;
  const glyphColumnWidth = Math.round(COLUMN_WIDTH_8PT_PX * scale);
  const linePitchPx = Math.round(LINE_PITCH_8PT_PX * scale);
  // After font-size change, CSP lays out columns at ~1 em = 2× glyph box
  // (iPad usersave 2026-08-30: 5.82pt 3-col width 120 = 24+2×48, not 106 from
  // scaled prototype 57px). Scaled 57px clips the rightmost column.
  const interColumnPitchPx = glyphColumnWidth * 2;
  const lineCount = explicitLineCount(text);
  const maxLineChars = maxLineUtf16CharCount(text);
  const multiLine = lineCount > 1;

  let width = glyphColumnWidth;
  if (multiLine) {
    const twoLineAdj =
      lineCount === 2 ? Math.round(TWO_LINE_WIDTH_ADJ_8PT_PX * scale) : 0;
    width = glyphColumnWidth + (lineCount - 1) * interColumnPitchPx + twoLineAdj;
  }

  const heightPad = multiLine ? MULTI_LINE_HEIGHT_PAD_8PT_PX : 0;
  const height = maxLineChars * linePitchPx + heightPad;

  return {
    fontSizePt,
    glyphColumnWidth,
    linePitchPx,
    interColumnPitchPx,
    lineCount,
    maxLineChars,
    width,
    height,
    multiLine,
  };
}

/**
 * Vertical-text bbox from top-right anchor (single- or multi-line).
 * Multi-line: width uses inter-column pitch; height uses max line length (not total chars).
 */
export function estimateVerticalTextBBox(params: {
  text: string;
  fontSizeValue: number;
  anchorRight: number;
  anchorTop: number;
}): CanvasBBox & { metrics: VerticalTextMetrics } {
  const metrics = verticalTextMetrics(params.text, params.fontSizeValue);
  const right = params.anchorRight;
  const top = params.anchorTop;
  return {
    left: right - metrics.width,
    top,
    right,
    bottom: top + metrics.height,
    metrics,
  };
}

export function readFontSizeValue(payload: Uint8Array): number {
  return readU32(payload, 0);
}

export function encodeFontSizeValue(fontSizePt: number): Uint8Array {
  const out = new Uint8Array(4);
  writeU32(out, 0, Math.round(fontSizePt * FONT_SIZE_SCALE));
  return out;
}

/** Patch id=13 full-form run inner f64[0] (mm/pt); compact form unchanged. */
export function patchFontSizeId13Full(payload: Uint8Array, _fontSizePt: number): Uint8Array {
  const out = new Uint8Array(payload);
  if (out.length >= 16 + 10) {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setFloat64(16 + 2, MM_PER_PT, true);
  }
  return out;
}

export function bboxToSize(bbox: CanvasBBox): RenderSize {
  return {
    width: bbox.right - bbox.left,
    height: bbox.bottom - bbox.top,
  };
}

/** Scale L5 reference column metrics (33px @ 8pt) by font size. */
export function verticalMetricsAtFontSize(fontSizeValue: number): {
  fontSizePt: number;
  columnWidth: number;
  linePitchPx: number;
} {
  const fontSizePt = fontSizeValue / FONT_SIZE_SCALE;
  const scale = fontSizePt / BASE_FONT_SIZE_PT;
  const columnWidth = Math.round(COLUMN_WIDTH_8PT_PX * scale);
  const linePitchPx = Math.round(LINE_PITCH_8PT_PX * scale);
  return { fontSizePt, columnWidth, linePitchPx };
}

/**
 * Vertical-text bbox from top-right anchor.
 * CSP 5.0.1 ground truth: pitch ≈ 33px/char @ 8pt (not fontSize×1.2×pxPerPt).
 */
export function estimateVerticalBBox(params: {
  charCount: number;
  fontSizeValue: number;
  pxPerPtX1000?: number;
  anchorRight: number;
  anchorTop: number;
  columnWidth?: number;
  bboxScale?: number;
}): CanvasBBox {
  const scale = params.bboxScale ?? 1;
  const { columnWidth: baseWidth, linePitchPx: basePitch } = verticalMetricsAtFontSize(
    params.fontSizeValue,
  );
  const width =
    params.columnWidth != null
      ? Math.round(params.columnWidth * scale)
      : Math.round(baseWidth * scale);
  const pitchPx = Math.round(basePitch * scale);
  const height = Math.round(params.charCount * pitchPx);
  const right = params.anchorRight;
  const top = params.anchorTop;
  return {
    left: right - width,
    top,
    right,
    bottom: top + height,
  };
}

function detectCentiPxVariant(payload: Uint8Array | undefined): 'simple' | 'offset' {
  if (!payload || payload.length < 20) return 'simple';
  const v2 = readI32(payload, 8);
  const v4 = readI32(payload, 16);
  return v2 === 100 && v4 === 100 ? 'offset' : 'simple';
}

function syncScalarPair(
  attrEntries: TlvEntry[],
  addEntries: TlvEntry[],
  paramId: number,
  payload: Uint8Array,
  skipAdd = false,
): void {
  setTlvPayload(attrEntries, paramId, payload);
  if (!skipAdd) {
    const addEntry = findTlvEntry(addEntries, paramId);
    if (addEntry) {
      if (paramId === 57) {
        setTlvPayload(addEntries, paramId, new Uint8Array(0));
      } else {
        setTlvPayload(addEntries, paramId, new Uint8Array(payload));
      }
    }
  }
}

function applyBBoxToEntries(
  attrEntries: TlvEntry[],
  addEntries: TlvEntry[],
  bbox: CanvasBBox,
  centiVariant: 'simple' | 'offset',
  multiLine = false,
): void {
  const size = bboxToSize(bbox);
  const bboxPayload = encodeCanvasBBox(bbox);
  const sizePayload = encodeRenderSize(size);
  // Multi-line prototypes / CSP usersave: id=64 uses width−1 (L6 −9000 for
  // 91px, usersave −11900 for 120px). id=72 already stores width−1.
  const centiWidth = multiLine ? Math.max(0, size.width - 1) : size.width;
  const centiPayload = encodeRenderRectCentiPx(centiWidth, size.height, centiVariant);
  const hintPayload = encodeCacheWidthHint(size.width, multiLine);

  syncScalarPair(attrEntries, addEntries, 42, bboxPayload);
  syncScalarPair(attrEntries, addEntries, 63, sizePayload);
  syncScalarPair(attrEntries, addEntries, 64, centiPayload);
  syncScalarPair(attrEntries, addEntries, 72, hintPayload);
}

/** Apply a patch to both Attributes (full) and AddAttributes (compact) blobs. */
export function patchTextLayerTlv(
  attributes: Uint8Array,
  addAttributes: Uint8Array,
  patch: TextLayerPatch,
): { attributes: Uint8Array; addAttributes: Uint8Array } {
  const attrBlob = parseTextLayerAttributes(attributes);
  const addBlob = parseTextLayerAddAttributes(addAttributes);
  const attrEntries = cloneEntries(attrBlob.entries);
  const addEntries = cloneEntries(addBlob.entries);
  let centiVariant = detectCentiPxVariant(getTlvPayload(attrEntries, 64));
  if (patch.multiLine) {
    centiVariant = 'offset';
  }

  if (patch.charCount != null) {
    const count = patch.charCount;
    for (const id of RUN_ARRAY_IDS) {
      const full = getTlvPayload(attrEntries, id);
      if (full) {
        setTlvPayload(attrEntries, id, patchFullRunVtype(full, count));
      }
    }
    const id39 = getTlvPayload(attrEntries, 39);
    if (id39) {
      syncScalarPair(attrEntries, addEntries, 39, patchCharCountId39(id39, count));
    }
  }

  if (patch.fontSizePt != null) {
    const fsPayload = encodeFontSizeValue(patch.fontSizePt);
    syncScalarPair(attrEntries, addEntries, 32, fsPayload);
    const id13 = getTlvPayload(attrEntries, 13);
    if (id13) {
      setTlvPayload(attrEntries, 13, patchFontSizeId13Full(id13, patch.fontSizePt));
    }
  }

  let bbox: CanvasBBox | undefined = patch.bbox;

  if (patch.positionDelta) {
    const id42 = getTlvPayload(attrEntries, 42);
    if (!id42) throw new TextTlvError('id=42 missing for position patch');
    const current = readCanvasBBox(id42);
    bbox = {
      left: current.left + patch.positionDelta.x,
      top: current.top + patch.positionDelta.y,
      right: current.right + patch.positionDelta.x,
      bottom: current.bottom + patch.positionDelta.y,
    };
  }

  if (bbox) {
    applyBBoxToEntries(
      attrEntries,
      addEntries,
      bbox,
      centiVariant,
      patch.multiLine ?? false,
    );
  } else if (patch.bboxScale != null && patch.bboxScale !== 1) {
    const id42 = getTlvPayload(attrEntries, 42);
    if (!id42) throw new TextTlvError('id=42 missing for bbox scale');
    const current = readCanvasBBox(id42);
    const cx = (current.left + current.right) / 2;
    const cy = (current.top + current.bottom) / 2;
    const halfW = ((current.right - current.left) / 2) * patch.bboxScale;
    const halfH = ((current.bottom - current.top) / 2) * patch.bboxScale;
    const scaled: CanvasBBox = {
      left: Math.round(cx - halfW),
      top: Math.round(cy - halfH),
      right: Math.round(cx + halfW),
      bottom: Math.round(cy + halfH),
    };
    applyBBoxToEntries(attrEntries, addEntries, scaled, centiVariant, patch.multiLine ?? false);
  }

  if (patch.floatCacheOffscreenId != null) {
    const id50 = new Uint8Array(4);
    writeU32(id50, 0, patch.floatCacheOffscreenId);
    syncScalarPair(attrEntries, addEntries, 50, id50);
  }

  return {
    attributes: serializeTextLayerAttributes({ entries: attrEntries }),
    addAttributes: serializeTextLayerAddAttributes({ header: 0, entries: addEntries }),
  };
}

/** Convenience: patch string + vertical bbox from top-right anchor (single- or multi-line). */
export function patchTextLayerForStringChange(
  attributes: Uint8Array,
  addAttributes: Uint8Array,
  newText: string,
  options?: { anchorRight?: number; anchorTop?: number; columnWidth?: number; fontSizePt?: number },
): { attributes: Uint8Array; addAttributes: Uint8Array } {
  const charCount = utf16CharCount(newText);
  const attrBlob = parseTextLayerAttributes(attributes);
  const id42 = getTlvPayload(attrBlob.entries, 42);
  const id32 = getTlvPayload(attrBlob.entries, 32);
  if (!id42 || !id32) {
    throw new TextTlvError('missing id=42/32 for string change');
  }
  const current = readCanvasBBox(id42);
  const fontSizeValue =
    options?.fontSizePt != null
      ? Math.round(options.fontSizePt * FONT_SIZE_SCALE)
      : readFontSizeValue(id32);
  const estimated = estimateVerticalTextBBox({
    text: newText,
    fontSizeValue,
    anchorRight: options?.anchorRight ?? current.right,
    anchorTop: options?.anchorTop ?? current.top,
  });
  return patchTextLayerTlv(attributes, addAttributes, {
    charCount,
    bbox: estimated,
    multiLine: estimated.metrics.multiLine,
    fontSizePt: options?.fontSizePt,
  });
}

/** Pick sample prototype MainId by explicit line count (L5=1, L6=2, L7=3+). */
export function textLayerPrototypeMainId(text: string): number {
  const lines = explicitLineCount(text);
  if (lines >= 3) return 7;
  if (lines === 2) return 6;
  return 5;
}
