import { describe, expect, test } from 'vitest';
import { PAGE_DISPLAY_H } from '../stripGeometry';
import {
  DEFAULT_PDF_DRAWER_HEIGHT,
  DEFAULT_PDF_DRAWER_WIDTH,
  DEFAULT_STOCK_DRAWER_HEIGHT,
  DEFAULT_STOCK_DRAWER_WIDTH,
  DEFAULT_UI_LAYOUT,
  nextPdfDrawerHeight,
  nextPdfDrawerWidth,
  nextStockDrawerHeight,
  nextStockDrawerWidth,
  PDF_DRAWER_HEIGHT_MAX,
  PDF_DRAWER_HEIGHT_MIN,
  PDF_DRAWER_WIDTH_MAX,
  PDF_DRAWER_WIDTH_MIN,
  STOCK_DRAWER_HEIGHT_MAX,
  STOCK_DRAWER_HEIGHT_MIN,
  STOCK_DRAWER_WIDTH_MAX,
  STOCK_DRAWER_WIDTH_MIN,
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

  test('right edge of a left-anchored drawer moving right grows width', () => {
    expect(nextPdfDrawerWidth(0.4, 100, 1000, 'left')).toBeCloseTo(0.5);
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

describe('stock drawer resize', () => {
  test('left edge moving right shrinks width', () => {
    expect(nextStockDrawerWidth(0.5, 100, 1000)).toBeCloseTo(0.4);
  });

  test('top edge moving up grows height', () => {
    expect(nextStockDrawerHeight(0.4, -80, 800)).toBeCloseTo(0.5);
  });

  test('bottom edge moving down grows height when stock is on top', () => {
    expect(nextStockDrawerHeight(0.4, 80, 800, 's')).toBeCloseTo(0.5);
  });

  test('clamps to min and max', () => {
    expect(nextStockDrawerWidth(DEFAULT_STOCK_DRAWER_WIDTH, 10_000, 100)).toBe(STOCK_DRAWER_WIDTH_MIN);
    expect(nextStockDrawerWidth(DEFAULT_STOCK_DRAWER_WIDTH, -10_000, 100)).toBe(STOCK_DRAWER_WIDTH_MAX);
    expect(nextStockDrawerHeight(DEFAULT_STOCK_DRAWER_HEIGHT, 10_000, 100)).toBe(STOCK_DRAWER_HEIGHT_MIN);
    expect(nextStockDrawerHeight(DEFAULT_STOCK_DRAWER_HEIGHT, -10_000, 100)).toBe(STOCK_DRAWER_HEIGHT_MAX);
  });
});
