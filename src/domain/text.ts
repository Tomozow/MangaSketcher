import type {
  EditorDocument,
  PageId,
  PageText,
  PasteboardText,
  Rect,
  TextDocument,
  TextId,
} from './types';
import { DEFAULT_TOOL_PROPERTIES } from './types';

type SelectedTextDocument = TextDocument & Pick<EditorDocument, 'selectedTextId'>;

/** One vertical column: width = glyph cell (same 1.2 as TEXT_WRAP_LINE_HEIGHT). */
export function defaultTextBox(
  rw: number,
  rh: number,
  fontSize: number = DEFAULT_TOOL_PROPERTIES.textFontSize,
): Pick<Rect, 'width' | 'height'> {
  const fontPx = Math.max(1, Number.isFinite(fontSize) ? fontSize : DEFAULT_TOOL_PROPERTIES.textFontSize);
  return {
    width: Math.min(rw, Math.ceil(fontPx * 1.2)),
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
): Omit<PageText, 'id'> & { id: string } {
  return {
    id,
    content: '',
    box: { ...box },
    fontSize,
    color,
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

/** 選択中テキスト枠の本文編集用。回転なし・縦書き。未選択は null。 */
export function selectedTextForEditor(doc: SelectedTextDocument): {
  id: TextId;
  content: string;
  color: string;
  fontSize: number;
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
  };
}

export function toPageText(pasteboardText: PasteboardText, pageBox: Rect): PageText {
  return {
    id: pasteboardText.id,
    content: pasteboardText.content,
    box: pageBox,
    fontSize: pasteboardText.fontSize,
    color: pasteboardText.color,
  };
}

export function isVerticalWriting(): true {
  return true;
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

/** 縦書き表示用。空枠はグリフなし。 */
export function verticalGlyphs(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  return [...content];
}

/**
 * Canvas `fillText` は横組グリフのまま置く。画面の `text-orientation: mixed` では
 * 伸ばし棒・三点リーダなどが列方向に回るので、焼き込みでも同じ向きにする。
 */
const VERTICAL_RL_ROTATE_CODEPOINTS = new Set<number>([
  0x30fc, // ー
  0xff70, // ｰ
  0x2026, // …
  0x2025, // ‥
  0x22ef, // ⋯
  0x2014, // —
  0x2015, // ―
  0x2013, // –
  0x2010, // ‐
  0x2212, // −
  0xff0d, // －
  0x301c, // 〜
  0xff5e, // ～
]);

export function shouldRotateForVerticalRl(glyph: string): boolean {
  const codePoint = glyph.codePointAt(0);
  return codePoint != null && VERTICAL_RL_ROTATE_CODEPOINTS.has(codePoint);
}

