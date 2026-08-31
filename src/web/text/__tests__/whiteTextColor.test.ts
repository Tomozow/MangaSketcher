import { describe, expect, test } from 'vitest';
import { isWhiteTextColor } from '../whiteTextColor';

describe('isWhiteTextColor', () => {
  test('matches palette and CSS whites', () => {
    expect(isWhiteTextColor('#FFFFFF')).toBe(true);
    expect(isWhiteTextColor('#fff')).toBe(true);
    expect(isWhiteTextColor('white')).toBe(true);
    expect(isWhiteTextColor('rgb(255, 255, 255)')).toBe(true);
  });

  test('rejects ink blacks and accents', () => {
    expect(isWhiteTextColor('#1A1A1A')).toBe(false);
    expect(isWhiteTextColor('#C45C26')).toBe(false);
    expect(isWhiteTextColor(undefined)).toBe(false);
  });
});
