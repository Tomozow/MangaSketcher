import { describe, expect, test } from 'vitest';
import { formatExportProgress, padPageIndex } from '../constants';
import { formatExportTimestamp, sanitizeExportStem } from '../sanitizeExportName';

describe('sanitizeExportStem', () => {
  test('replaces path and windows-forbidden characters', () => {
    expect(sanitizeExportStem('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
  });

  test('empty or whitespace becomes 無題', () => {
    expect(sanitizeExportStem('')).toBe('無題');
    expect(sanitizeExportStem('   ')).toBe('無題');
  });

  test('leading dot becomes underscore', () => {
    expect(sanitizeExportStem('.hidden')).toBe('_hidden');
  });

  test('trailing dots and spaces are stripped', () => {
    expect(sanitizeExportStem('name. ')).toBe('name');
    expect(sanitizeExportStem('name...')).toBe('name');
  });

  test('truncates to 80 UTF-16 units', () => {
    const input = 'あ'.repeat(81);
    const stem = sanitizeExportStem(input);
    expect(stem.length).toBe(80);
    expect(stem).toBe('あ'.repeat(80));
  });

  test('keeps Japanese and interior dots', () => {
    expect(sanitizeExportStem('漫画.下書き')).toBe('漫画.下書き');
  });
});

describe('formatExportTimestamp', () => {
  test('uses local getters not UTC', () => {
    const date = new Date(2026, 7, 29, 15, 7, 59);
    expect(formatExportTimestamp(date)).toBe('20260829-1507');
  });
});

describe('progress and page index', () => {
  test('progress uses U+2026', () => {
    expect(formatExportProgress(3, 12)).toBe('3/12 ページ…');
    expect(formatExportProgress(3, 12).endsWith('\u2026')).toBe(true);
  });

  test('page index is at least 3 digits', () => {
    expect(padPageIndex(1)).toBe('001');
    expect(padPageIndex(1000)).toBe('1000');
  });
});
