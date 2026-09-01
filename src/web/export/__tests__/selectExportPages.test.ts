import { describe, expect, test } from 'vitest';
import { selectExportPages, sanitizeRangeInput } from '../selectExportPages';

describe('sanitizeRangeInput', () => {
  test('keeps leading integer and drops the rest', () => {
    expect(sanitizeRangeInput('')).toBe('');
    expect(sanitizeRangeInput('12')).toBe('12');
    expect(sanitizeRangeInput('3.9')).toBe('3');
    expect(sanitizeRangeInput('abc')).toBe('');
  });
});

describe('selectExportPages', () => {
  const order = ['a', 'b', 'c', 'd'];

  test('all pages', () => {
    const result = selectExportPages({
      workspaceOrder: order,
      selectedPageId: 'c',
      mode: 'all',
      rangeStartRaw: '',
      rangeEndRaw: '',
    });
    expect(result.pageIds).toEqual(order);
    expect(result.firstNumber).toBe(1);
    expect(result.lastNumber).toBe(4);
    expect(result.canExport).toBe(true);
    expect(result.currentDisabled).toBe(false);
  });

  test('current page disabled when selection is missing', () => {
    const result = selectExportPages({
      workspaceOrder: order,
      selectedPageId: 'stock',
      mode: 'current',
      rangeStartRaw: '',
      rangeEndRaw: '',
    });
    expect(result.canExport).toBe(false);
    expect(result.currentDisabled).toBe(true);
  });

  test('range swaps inverted bounds and clamps', () => {
    const result = selectExportPages({
      workspaceOrder: order,
      selectedPageId: 'b',
      mode: 'range',
      rangeStartRaw: '12',
      rangeEndRaw: '3',
    });
    expect(result.pageIds).toEqual(['c', 'd']);
    expect(result.firstNumber).toBe(3);
    expect(result.lastNumber).toBe(4);
  });

  test('empty range fields fall back to the current page', () => {
    const result = selectExportPages({
      workspaceOrder: order,
      selectedPageId: 'c',
      mode: 'range',
      rangeStartRaw: '',
      rangeEndRaw: '',
    });
    expect(result.pageIds).toEqual(['c']);
    expect(result.count).toBe(1);
  });

  test('empty workspace cannot export', () => {
    const result = selectExportPages({
      workspaceOrder: [],
      selectedPageId: null,
      mode: 'all',
      rangeStartRaw: '1',
      rangeEndRaw: '1',
    });
    expect(result.canExport).toBe(false);
    expect(result.count).toBe(0);
  });
});
