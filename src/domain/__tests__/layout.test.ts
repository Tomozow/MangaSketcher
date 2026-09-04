import { describe, expect, test } from 'vitest';

import { previewSpreadPageIds, spreadPageIdsContaining } from '../layout';

describe('spreadPageIdsContaining', () => {
  const order = ['p1', 'p2', 'p3', 'p4', 'p5'];

  test('null and unknown ids are empty', () => {
    expect(spreadPageIdsContaining(order, null)).toEqual([]);
    expect(spreadPageIdsContaining(order, 'stock')).toEqual([]);
  });

  test('page 1 is alone with the start blank', () => {
    expect(spreadPageIdsContaining(order, 'p1')).toEqual(['p1']);
  });

  test('pages 2 and 3 share a spread', () => {
    expect(spreadPageIdsContaining(order, 'p2')).toEqual(['p3', 'p2']);
    expect(spreadPageIdsContaining(order, 'p3')).toEqual(['p3', 'p2']);
  });

  test('pages 4 and 5 share a spread; a lone last page is a 6-page book', () => {
    expect(spreadPageIdsContaining(order, 'p5')).toEqual(['p5', 'p4']);
    expect(spreadPageIdsContaining([...order, 'p6'], 'p6')).toEqual(['p6']);
  });
});

describe('previewSpreadPageIds', () => {
  const order = ['p1', 'p2', 'p3', 'p4', 'p5'];

  test('uses the selected spread in LTR', () => {
    expect(previewSpreadPageIds(order, 'p2')).toEqual(['p3', 'p2']);
    expect(previewSpreadPageIds(order, 'p1')).toEqual(['p1']);
  });

  test('falls back to the first spread when selected is missing', () => {
    expect(previewSpreadPageIds(order, null)).toEqual(['p1']);
    expect(previewSpreadPageIds(order, 'stock')).toEqual(['p1']);
  });
});
