import { describe, expect, test } from 'vitest';
import { PAGE_DISPLAY_H } from '../stripGeometry';
import {
  DEFAULT_PDF_DRAWER_HEIGHT,
  DEFAULT_PDF_DRAWER_WIDTH,
  DEFAULT_UI_LAYOUT,
  nextPdfDrawerHeight,
  nextPdfDrawerWidth,
  PDF_DRAWER_HEIGHT_MAX,
  PDF_DRAWER_HEIGHT_MIN,
  PDF_DRAWER_WIDTH_MAX,
  PDF_DRAWER_WIDTH_MIN,
} from '../uiLayout';

describe('new project layout defaults', () => {
  test('1列3ページ・見開き余白126・仕切りあり・列の縦余白1ページ', () => {
    expect(DEFAULT_UI_LAYOUT.pagesPerColumn).toBe(3);
    expect(DEFAULT_UI_LAYOUT.pairGap).toBe(126);
    expect(DEFAULT_UI_LAYOUT.showPairDivider).toBe(true);
    expect(DEFAULT_UI_LAYOUT.columnGap).toBe(PAGE_DISPLAY_H);
  });
});

describe('pdf drawer resize', () => {
  test('left edge moving right shrinks width', () => {
    expect(nextPdfDrawerWidth(0.4, 100, 1000)).toBeCloseTo(0.3);
  });

  test('bottom edge moving down grows height', () => {
    expect(nextPdfDrawerHeight(0.5, 80, 800)).toBeCloseTo(0.6);
  });

  test('clamps to min and max', () => {
    expect(nextPdfDrawerWidth(DEFAULT_PDF_DRAWER_WIDTH, 10_000, 100)).toBe(PDF_DRAWER_WIDTH_MIN);
    expect(nextPdfDrawerWidth(DEFAULT_PDF_DRAWER_WIDTH, -10_000, 100)).toBe(PDF_DRAWER_WIDTH_MAX);
    expect(nextPdfDrawerHeight(DEFAULT_PDF_DRAWER_HEIGHT, -10_000, 100)).toBe(PDF_DRAWER_HEIGHT_MIN);
    expect(nextPdfDrawerHeight(0.4, 10_000, 100)).toBe(PDF_DRAWER_HEIGHT_MAX);
  });
});
