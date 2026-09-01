import { describe, expect, test } from 'vitest';
import {
  EXTRACT_CHARS_PER_COL,
  EXTRACT_GAP,
  EXTRACT_LINE_HEIGHT,
  EXTRACT_TEXT_HEIGHT,
  extractedColumnCount,
  extractedTextBoxSize,
  nextExtractPack,
  startExtractPack,
  wrapExtractedText,
  workspaceFontSizeFromTool,
} from '../pdfExtractPack';

describe('wrapExtractedText', () => {
  test('10文字ごとに改行し、ちょうど10文字なら改行しない', () => {
    expect(wrapExtractedText('あ'.repeat(10))).toBe('あ'.repeat(10));
    expect(wrapExtractedText('あ'.repeat(11))).toBe(`${'あ'.repeat(10)}\nあ`);
    expect(wrapExtractedText('あ'.repeat(21))).toBe(`${'あ'.repeat(10)}\n${'あ'.repeat(10)}\nあ`);
  });

  test('3列以上でも改行を続ける', () => {
    expect(extractedColumnCount('あ'.repeat(21))).toBe(3);
    expect(extractedColumnCount('あ'.repeat(40))).toBe(4);
    expect(wrapExtractedText('あ'.repeat(40)).split('\n')).toHaveLength(4);
  });

  test('半角スペースは列の1マスとして残る', () => {
    expect(wrapExtractedText('あ い')).toBe('あ い');
    expect(wrapExtractedText(`${'あ'.repeat(9)} い`)).toBe(`${'あ'.repeat(9)} \nい`);
  });

  test('改行後の行頭スペースは落とす', () => {
    expect(wrapExtractedText(`${'あ'.repeat(10)} い`)).toBe(`${'あ'.repeat(10)}\nい`);
    expect(wrapExtractedText(` あ${'い'.repeat(9)} う`)).toBe(`あ${'い'.repeat(9)}\nう`);
  });
});

describe('extractedTextBoxSize', () => {
  test('横幅は折り返し後の列数、高さは10文字分', () => {
    const font = 36;
    const pitch = font * EXTRACT_LINE_HEIGHT;
    const height = Math.ceil(EXTRACT_CHARS_PER_COL * pitch);
    const one = extractedTextBoxSize('あ'.repeat(EXTRACT_CHARS_PER_COL), font);
    expect(one).toEqual({ width: Math.ceil(pitch), height });
    const two = extractedTextBoxSize('あ'.repeat(EXTRACT_CHARS_PER_COL + 1), font);
    expect(two).toEqual({ width: Math.ceil(pitch * 2), height });
    const three = extractedTextBoxSize('あ'.repeat(21), font);
    expect(three).toEqual({ width: Math.ceil(pitch * 3), height });
    const four = extractedTextBoxSize('あ'.repeat(40), font);
    expect(four).toEqual({ width: Math.ceil(pitch * 4), height });
  });

  test('サイズ24の奇数列は列ピッチの端数を切り上げて左端が欠けない', () => {
    const font = 24;
    expect(extractedTextBoxSize('あ', font).width).toBe(29);
    expect(extractedTextBoxSize('あ'.repeat(21), font).width).toBe(87);
  });

  test('テキストツールのサイズはページ表示スケールに写す', () => {
    expect(workspaceFontSizeFromTool(36, 1200)).toBeCloseTo(36 * (216 / 1200));
  });
});

describe('extract pack RTL', () => {
  test('1件目は画面中央、隣は左、行末なら一段下の右へ', () => {
    const viewport = { left: 0, top: 0, right: 400, bottom: 800, zoom: 1 };
    const narrow = { width: 36, height: EXTRACT_TEXT_HEIGHT };
    const first = startExtractPack(viewport, narrow);
    expect(first.box.x).toBe((400 - 36) / 2);
    expect(first.box.y).toBe((800 - EXTRACT_TEXT_HEIGHT) / 2);

    const left = nextExtractPack(first.cursor, narrow);
    expect(left.box.x).toBe(first.box.x - EXTRACT_GAP - narrow.width);
    expect(left.box.y).toBe(first.box.y);

    const wide = { width: 300, height: EXTRACT_TEXT_HEIGHT };
    const started = startExtractPack(viewport, wide);
    const wrapped = nextExtractPack(started.cursor, { width: 80, height: EXTRACT_TEXT_HEIGHT });
    expect(wrapped.box.y).toBe(started.box.y + EXTRACT_TEXT_HEIGHT + EXTRACT_GAP);
    expect(wrapped.box.x + wrapped.box.width).toBe(started.box.x + started.box.width);
  });
});
