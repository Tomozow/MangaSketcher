import type {
  EditorDocument,
  PageId,
  PageText,
  PasteboardText,
  Rect,
  TextDocument,
  TextId,
  WritingMode,
} from './types';
import { DEFAULT_TOOL_PROPERTIES, writingModeOf } from './types';

type SelectedTextDocument = TextDocument & Pick<EditorDocument, 'selectedTextId'>;

/** Empty box: vertical is one 1.5em column × 1em; horizontal is 1em × 1.5em row. */
export function defaultTextBox(
  rw: number,
  rh: number,
  fontSize: number = DEFAULT_TOOL_PROPERTIES.textFontSize,
  writingMode: WritingMode = 'vertical',
): Pick<Rect, 'width' | 'height'> {
  const fontPx = Math.max(1, Number.isFinite(fontSize) ? fontSize : DEFAULT_TOOL_PROPERTIES.textFontSize);
  if (writingModeOf(writingMode) === 'horizontal') {
    return {
      width: Math.min(rw, Math.ceil(fontPx)),
      height: Math.min(rh, Math.ceil(fontPx * 1.5)),
    };
  }
  return {
    width: Math.min(rw, Math.ceil(fontPx * 1.5)),
    height: Math.min(rh, Math.ceil(fontPx)),
  };
}

/** Keep a text box origin inside page raster bounds. */
export function clampTextBoxOrigin(
  x: number,
  y: number,
  width: number,
  height: number,
  rasterWidth: number,
  rasterHeight: number,
): { x: number; y: number } {
  const safeWidth = Math.max(4, width);
  const safeHeight = Math.max(4, height);
  return {
    x: Math.max(0, Math.min(x, rasterWidth - safeWidth)),
    y: Math.max(0, Math.min(y, rasterHeight - safeHeight)),
  };
}

export function createEmptyTextBox(
  id: string,
  box: Rect,
  color: string,
  fontSize: number,
  writingMode: WritingMode = 'vertical',
): Omit<PageText, 'id'> & { id: string } {
  return {
    id,
    content: '',
    box: { ...box },
    fontSize,
    color,
    writingMode: writingModeOf(writingMode),
  };
}

export function findText(
  doc: TextDocument,
  textId: TextId,
): { node: PageText | PasteboardText; where: 'page' | 'pasteboard'; pageId?: PageId } | null {
  for (const page of Object.values(doc.pages)) {
    const t = page.texts.find((x) => x.id === textId);
    if (t) {
      return { node: t, where: 'page', pageId: page.id };
    }
  }
  const pb = doc.pasteboardTexts.find((x) => x.id === textId);
  return pb ? { node: pb, where: 'pasteboard' } : null;
}

/** 選択中テキスト枠の本文編集用。回転なし。未選択は null。 */
export function selectedTextForEditor(doc: SelectedTextDocument): {
  id: TextId;
  content: string;
  color: string;
  fontSize: number;
  writingMode: WritingMode;
  where: 'page' | 'pasteboard';
  pageId?: PageId;
} | null {
  if (!doc.selectedTextId) {
    return null;
  }
  const found = findText(doc, doc.selectedTextId);
  if (!found) {
    return null;
  }
  return {
    id: doc.selectedTextId,
    content: found.node.content,
    color: found.node.color,
    fontSize: found.node.fontSize,
    writingMode: writingModeOf(found.node.writingMode),
    where: found.where,
    pageId: found.pageId,
  };
}

/**
 * 枠リサイズは縦横比を保ち、同じ倍率でフォントを追従させる。回転なし。
 */
export function resizeTextBox<T extends { box: Rect; fontSize: number }>(
  item: T,
  nextBox: Rect,
): T {
  const oldW = Math.max(1, item.box.width);
  const oldH = Math.max(1, item.box.height);
  const scale = Math.max(0.1, Math.max(nextBox.width / oldW, nextBox.height / oldH));
  return {
    ...item,
    box: {
      x: nextBox.x,
      y: nextBox.y,
      width: Math.max(4, oldW * scale),
      height: Math.max(4, oldH * scale),
    },
    fontSize: Math.max(1, item.fontSize * scale),
  };
}

/** SE ハンドル位置から縦横比固定の新しい枠を求める。 */
export function uniformResizeFromSE(box: Rect, pointerX: number, pointerY: number): Rect {
  const scaleW = (pointerX - box.x) / Math.max(1, box.width);
  const scaleH = (pointerY - box.y) / Math.max(1, box.height);
  const scale = Math.max(0.15, Math.max(scaleW, scaleH));
  return {
    x: box.x,
    y: box.y,
    width: Math.max(4, box.width * scale),
    height: Math.max(4, box.height * scale),
  };
}

/** プロパティの文字サイズ変更。枠も同じ倍率で追従。 */
export function applyFontSizeToText<T extends { box: Rect; fontSize: number }>(
  item: T,
  fontSize: number,
): T {
  const next = Math.max(1, fontSize);
  const scale = next / Math.max(1, item.fontSize);
  return {
    ...item,
    fontSize: next,
    box: {
      ...item.box,
      width: Math.max(4, item.box.width * scale),
      height: Math.max(4, item.box.height * scale),
    },
  };
}

export function moveTextBox<T extends { box: Rect }>(item: T, x: number, y: number): T {
  return { ...item, box: { ...item.box, x, y } };
}

export type TextHitKind = 'body' | 'se';

export function hitTextBox(box: Rect, x: number, y: number, handle: number): TextHitKind | null {
  const pad = Math.max(3, handle);
  const seX = box.x + box.width - pad;
  const seY = box.y + box.height - pad;
  if (x >= seX && y >= seY && x <= box.x + box.width + pad && y <= box.y + box.height + pad) {
    return 'se';
  }
  if (x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height) {
    return 'body';
  }
  return null;
}

export function toPasteboardText(pageText: PageText, workspaceBox: Rect): PasteboardText {
  return {
    id: pageText.id,
    content: pageText.content,
    box: workspaceBox,
    fontSize: pageText.fontSize,
    color: pageText.color,
    writingMode: writingModeOf(pageText.writingMode),
  };
}

export function toPageText(pasteboardText: PasteboardText, pageBox: Rect): PageText {
  return {
    id: pasteboardText.id,
    content: pasteboardText.content,
    box: pageBox,
    fontSize: pasteboardText.fontSize,
    color: pasteboardText.color,
    writingMode: writingModeOf(pasteboardText.writingMode),
  };
}

export function selectedTextIdsOf(doc: {
  selectedTextId: TextId | null;
  selectedTextIds?: readonly TextId[] | null;
}): TextId[] {
  if (Array.isArray(doc.selectedTextIds)) {
    return [...doc.selectedTextIds];
  }
  return doc.selectedTextId ? [doc.selectedTextId] : [];
}

export function textSelectionState(ids: TextId[]): {
  selectedTextId: TextId | null;
  selectedTextIds: TextId[];
} {
  const selectedTextIds = [...new Set(ids)];
  return {
    selectedTextIds,
    selectedTextId: selectedTextIds[selectedTextIds.length - 1] ?? null,
  };
}

export function withoutTextSelection<T extends { selectedTextId: TextId | null; selectedTextIds?: TextId[] }>(
  doc: T,
): T {
  return { ...doc, ...textSelectionState([]) };
}

/** Keep the live UI selection if those texts still exist on `doc`. */
export function withLiveTextSelection<T extends TextDocument & { selectedTextId: TextId | null; selectedTextIds?: TextId[] }>(
  doc: T,
  live: { selectedTextId: TextId | null; selectedTextIds?: readonly TextId[] | null },
): T {
  return {
    ...doc,
    ...textSelectionState(selectedTextIdsOf(live).filter((id) => findText(doc, id))),
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.width > 0 &&
    b.width > 0 &&
    a.height > 0 &&
    b.height > 0 &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** 空枠（未入力）判定。空白・改行のみも空とみなす。 */
export function isTextContentEmpty(content: string): boolean {
  return content.trim().length === 0;
}

/** iPad insertLineBreak may insert CR or CRLF; wrapping only treats LF as a column break. */
export function normalizeEditNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function mapIndexAfterNewlineNormalize(raw: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, raw.length));
  let out = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (raw[i] === '\r' && raw[i + 1] === '\n') {
      continue;
    }
    out += 1;
  }
  return out;
}

/** 縦書き表示用。空枠はグリフなし。 */
export function verticalGlyphs(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  return [...content];
}

/**
 * Unicode presentation forms for vertical (OpenType `vert` destinations that
 * have cmap codepoints). Canvas cannot enable `vert`, so PDF/thumb bake uses these.
 */
const VERTICAL_RL_PRESENTATION: Readonly<Record<number, string>> = {
  0x2014: '\uFE31', // — → ︱
  0x2026: '\uFE19', // … → ︙
  0x3001: '\uFE11', // 、
  0x3002: '\uFE12', // 。
  0x3008: '\uFE3F', // 〈
  0x3009: '\uFE40', // 〉
  0x300a: '\uFE3D', // 《
  0x300b: '\uFE3E', // 》
  0x300c: '\uFE41', // 「
  0x300d: '\uFE42', // 」
  0x300e: '\uFE43', // 『
  0x300f: '\uFE44', // 』
  0x3010: '\uFE3B', // 【
  0x3011: '\uFE3C', // 】
  0x3014: '\uFE39', // 〔
  0x3015: '\uFE3A', // 〕
  0x3016: '\uFE17', // 〖
  0x3017: '\uFE18', // 〗
  0xff08: '\uFE35', // （
  0xff09: '\uFE36', // ）
  0xff0c: '\uFE10', // ，
  0xff3f: '\uFE33', // ＿
  0xff5b: '\uFE37', // ｛
  0xff5d: '\uFE38', // ｝
  0x0028: '\uFE35', // (
  0x0029: '\uFE36', // )
  0x007b: '\uFE37', // {
  0x007d: '\uFE38', // }
};

/**
 * Canvas `fillText` は横組グリフのまま置く。画面の `text-orientation: mixed` では
 * 伸ばし棒などが列方向に回るので、縦書き互換文字が無いものは焼き込みでも回す。
 */
const VERTICAL_RL_ROTATE_CODEPOINTS = new Set<number>([
  0x30fc, // ー
  0xff70, // ｰ
  0x2025, // ‥
  0x22ef, // ⋯
  0x2015, // ―
  0x2013, // –
  0x2010, // ‐
  0x2212, // −
  0xff0d, // －
  0x301c, // 〜
  0xff5e, // ～
]);

export function verticalRlCanvasGlyph(glyph: string): string {
  const codePoint = glyph.codePointAt(0);
  if (codePoint == null) {
    return glyph;
  }
  return VERTICAL_RL_PRESENTATION[codePoint] ?? glyph;
}

export function shouldRotateForVerticalRl(glyph: string): boolean {
  if (verticalRlCanvasGlyph(glyph) !== glyph) {
    return false;
  }
  const codePoint = glyph.codePointAt(0);
  return codePoint != null && VERTICAL_RL_ROTATE_CODEPOINTS.has(codePoint);
}

