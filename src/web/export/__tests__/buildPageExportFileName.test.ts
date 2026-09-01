import { describe, expect, test } from 'vitest';
import { buildPageExportFileName } from '../buildPageExportFileName';

describe('buildPageExportFileName', () => {
  test('single page uses pNNN for each format', () => {
    expect(
      buildPageExportFileName({
        format: 'png',
        stem: '題',
        timestamp: '20260901-1400',
        pick: 'all',
        count: 1,
        firstNumber: 1,
        lastNumber: 1,
      }),
    ).toBe('題_20260901-1400_p001.png');
    expect(
      buildPageExportFileName({
        format: 'pdf',
        stem: '題',
        timestamp: '20260901-1400',
        pick: 'current',
        count: 1,
        firstNumber: 12,
        lastNumber: 12,
      }),
    ).toBe('題_20260901-1400_p012.pdf');
  });

  test('all pages with 2+ omit the range token', () => {
    expect(
      buildPageExportFileName({
        format: 'png',
        stem: '題',
        timestamp: '20260901-1400',
        pick: 'all',
        count: 4,
        firstNumber: 1,
        lastNumber: 4,
      }),
    ).toBe('題_20260901-1400.zip');
    expect(
      buildPageExportFileName({
        format: 'pdf',
        stem: '題',
        timestamp: '20260901-1400',
        pick: 'all',
        count: 4,
        firstNumber: 1,
        lastNumber: 4,
      }),
    ).toBe('題_20260901-1400.pdf');
    expect(
      buildPageExportFileName({
        format: 'clip',
        stem: '題',
        timestamp: '20260901-1400',
        pick: 'all',
        count: 4,
        firstNumber: 1,
        lastNumber: 4,
      }),
    ).toBe('題_20260901-1400_clip.zip');
  });

  test('explicit range keeps p005-p012 even when it covers the whole workspace', () => {
    expect(
      buildPageExportFileName({
        format: 'pdf',
        stem: '題',
        timestamp: '20260901-1400',
        pick: 'range',
        count: 8,
        firstNumber: 5,
        lastNumber: 12,
      }),
    ).toBe('題_20260901-1400_p005-p012.pdf');
    expect(
      buildPageExportFileName({
        format: 'clip',
        stem: '題',
        timestamp: '20260901-1400',
        pick: 'range',
        count: 8,
        firstNumber: 5,
        lastNumber: 12,
      }),
    ).toBe('題_20260901-1400_p005-p012_clip.zip');
  });
});
