import type { DocumentState, PageId, PageText, PasteboardText, Rect, TextId } from './types';

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
  doc: DocumentState,
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
export function selectedTextForEditor(doc: DocumentState): {
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

/** 縦書き表示用。空枠はグリフなし。 */
export function verticalGlyphs(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  return [...content];
}

