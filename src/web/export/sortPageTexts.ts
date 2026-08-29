import type { Rect } from '../../domain/types';

export type OrderedTextBox = {
  box: Rect;
};

export function comparePageTextOrder(
  a: OrderedTextBox,
  b: OrderedTextBox,
  indexA: number,
  indexB: number,
): number {
  const rightA = a.box.x + a.box.width;
  const rightB = b.box.x + b.box.width;
  if (rightA !== rightB) {
    return rightB - rightA;
  }
  if (a.box.y !== b.box.y) {
    return a.box.y - b.box.y;
  }
  return indexA - indexB;
}

export function sortPageTexts<T extends OrderedTextBox>(texts: readonly T[]): T[] {
  return texts
    .map((text, index) => ({ text, index }))
    .sort((a, b) => comparePageTextOrder(a.text, b.text, a.index, b.index))
    .map((item) => item.text);
}
