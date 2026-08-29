import { describe, expect, test } from 'vitest';
import {
  EXTRACT_GAP,
  EXTRACT_TEXT_HEIGHT,
  extractedTextBoxSize,
  nextExtractPack,
  startExtractPack,
  workspaceFontSizeFromTool,
} from '../pdfExtractPack';

describe('extractedTextBoxSize', () => {
  test('高さは固定、幅は列数で伸びる', () => {
    const font = 36;
    const perCol = Math.floor(EXTRACT_TEXT_HEIGHT / font);
    const one = extractedTextBoxSize('あ'.repeat(perCol), font);
    expect(one).toEqual({ width: font, height: EXTRACT_TEXT_HEIGHT });
    const two = extractedTextBoxSize('あ'.repeat(perCol + 1), font);
    expect(two).toEqual({ width: font * 2, height: EXTRACT_TEXT_HEIGHT });
  });

  test('テキストツールのサイズはページ表示スケールに写す', () => {
    expect(workspaceFontSizeFromTool(36, 1200)).toBeCloseTo(36 * (216 / 1200));
  });
});

describe('extract pack RTL', () => {
  test('1件目は右上、隣は左、行末なら一段下の右へ', () => {
    const viewport = { left: 0, top: 0, right: 400, bottom: 800, zoom: 1 };
    const narrow = { width: 36, height: EXTRACT_TEXT_HEIGHT };
    const first = startExtractPack(viewport, narrow);
    expect(first.box.x + first.box.width).toBe(400 - 16);
    expect(first.box.y).toBe(16);

    const left = nextExtractPack(first.cursor, narrow);
    expect(left.box.x).toBe(first.box.x - EXTRACT_GAP - narrow.width);
    expect(left.box.y).toBe(first.box.y);

    const wide = { width: 300, height: EXTRACT_TEXT_HEIGHT };
    const wrapped = nextExtractPack(startExtractPack(viewport, wide).cursor, { width: 80, height: EXTRACT_TEXT_HEIGHT });
    expect(wrapped.box.y).toBe(16 + EXTRACT_TEXT_HEIGHT + EXTRACT_GAP);
    expect(wrapped.box.x + wrapped.box.width).toBe(400 - 16);
  });
});
