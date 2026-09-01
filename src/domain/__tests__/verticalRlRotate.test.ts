import { describe, expect, test } from 'vitest';
import { shouldRotateForVerticalRl } from '../text';

describe('shouldRotateForVerticalRl', () => {
  test('rotates prolonged sound marks and ellipses used in vertical copy', () => {
    expect(shouldRotateForVerticalRl('ー')).toBe(true);
    expect(shouldRotateForVerticalRl('ｰ')).toBe(true);
    expect(shouldRotateForVerticalRl('…')).toBe(true);
    expect(shouldRotateForVerticalRl('‥')).toBe(true);
    expect(shouldRotateForVerticalRl('〜')).toBe(true);
  });

  test('leaves kana and kanji upright', () => {
    expect(shouldRotateForVerticalRl('あ')).toBe(false);
    expect(shouldRotateForVerticalRl('漢')).toBe(false);
    expect(shouldRotateForVerticalRl('。')).toBe(false);
    expect(shouldRotateForVerticalRl('A')).toBe(false);
  });
});
