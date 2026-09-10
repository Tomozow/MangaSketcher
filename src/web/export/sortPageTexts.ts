import type { Rect, WritingMode } from '../../domain/types';
import { writingModeOf } from '../../domain/types';

export type OrderedTextBox = {
  box: Rect;
  writingMode?: WritingMode;
};

export function comparePageTextOrder(
  a: OrderedTextBox,
  b: OrderedTextBox,
  indexA: number,
  indexB: number,
): number {
  const horizontalA = writingModeOf(a.writingMode) === 'horizontal';
  const horizontalB = writingModeOf(b.writingMode) === 'horizontal';
  if (horizontalA !== horizontalB) {
    const keyA = horizontalA ? a.box.x : -(a.box.x + a.box.width);
    const keyB = horizontalB ? b.box.x : -(b.box.x + b.box.width);
    if (keyA !== keyB) {
      return keyA - keyB;
    }
  } else if (horizontalA) {
    if (a.box.x !== b.box.x) {
      return a.box.x - b.box.x;
    }
  } else {
    const rightA = a.box.x + a.box.width;
    const rightB = b.box.x + b.box.width;
    if (rightA !== rightB) {
      return rightB - rightA;
    }
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
