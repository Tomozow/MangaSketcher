import { describe, expect, test } from 'vitest';
import { shouldRotateForVerticalRl, verticalRlCanvasGlyph } from '../text';

describe('shouldRotateForVerticalRl', () => {
  test('rotates prolonged sound marks used in vertical copy', () => {
    expect(shouldRotateForVerticalRl('ー')).toBe(true);
    expect(shouldRotateForVerticalRl('ｰ')).toBe(true);
    expect(shouldRotateForVerticalRl('‥')).toBe(true);
    expect(shouldRotateForVerticalRl('〜')).toBe(true);
  });

  test('leaves kana, kanji, and vertical presentation punctuation upright', () => {
    expect(shouldRotateForVerticalRl('あ')).toBe(false);
    expect(shouldRotateForVerticalRl('漢')).toBe(false);
    expect(shouldRotateForVerticalRl('。')).toBe(false);
    expect(shouldRotateForVerticalRl('「')).toBe(false);
    expect(shouldRotateForVerticalRl('A')).toBe(false);
  });
});

describe('verticalRlCanvasGlyph', () => {
  test('maps corner and lenticular brackets to vertical presentation forms', () => {
    expect(verticalRlCanvasGlyph('「')).toBe('\uFE41');
    expect(verticalRlCanvasGlyph('」')).toBe('\uFE42');
    expect(verticalRlCanvasGlyph('【')).toBe('\uFE3B');
    expect(verticalRlCanvasGlyph('】')).toBe('\uFE3C');
    expect(verticalRlCanvasGlyph('あ')).toBe('あ');
  });
});
