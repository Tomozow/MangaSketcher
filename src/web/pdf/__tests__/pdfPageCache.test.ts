import { describe, expect, test } from 'vitest';
import { createPdfPageBitmapCache } from '../pdfPageCache';

function fakeBitmap(closed: number[], id: number) {
  return {
    width: 8,
    height: 8,
    close: () => {
      closed.push(id);
    },
  };
}

describe('createPdfPageBitmapCache', () => {
  test('reuses a sharper bitmap and closes the weaker duplicate', () => {
    const cache = createPdfPageBitmapCache(3);
    const closed: number[] = [];
    cache.put('pdfs/a.pdf', 1, 2, 2.5, fakeBitmap(closed, 1));
    cache.put('pdfs/a.pdf', 1, 2, 1.1, fakeBitmap(closed, 2));
    expect(cache.size).toBe(1);
    expect(closed).toEqual([2]);
    expect(cache.peek('pdfs/a.pdf', 1, 2)?.scale).toBe(2.5);
  });

  test('replaces a weaker bitmap for the same page', () => {
    const cache = createPdfPageBitmapCache(3);
    const closed: number[] = [];
    cache.put('pdfs/a.pdf', 1, 2, 1.1, fakeBitmap(closed, 1));
    cache.put('pdfs/a.pdf', 1, 2, 2.5, fakeBitmap(closed, 2));
    expect(cache.size).toBe(1);
    expect(closed).toEqual([1]);
    expect(cache.peek('pdfs/a.pdf', 1, 2)?.scale).toBe(2.5);
  });

  test('evicts the least recently used page when over the limit', () => {
    const cache = createPdfPageBitmapCache(3);
    const closed: number[] = [];
    cache.put('pdfs/a.pdf', 1, 1, 1, fakeBitmap(closed, 1));
    cache.put('pdfs/a.pdf', 1, 2, 1, fakeBitmap(closed, 2));
    cache.put('pdfs/a.pdf', 1, 3, 1, fakeBitmap(closed, 3));
    cache.get('pdfs/a.pdf', 1, 1);
    cache.put('pdfs/a.pdf', 1, 4, 1, fakeBitmap(closed, 4));
    expect(cache.size).toBe(3);
    expect(closed).toEqual([2]);
    expect(cache.peek('pdfs/a.pdf', 1, 2)).toBeNull();
    expect(cache.peek('pdfs/a.pdf', 1, 1)?.scale).toBe(1);
  });

  test('generation change drops every cached page', () => {
    const cache = createPdfPageBitmapCache(3);
    const closed: number[] = [];
    cache.put('pdfs/a.pdf', 1, 1, 1, fakeBitmap(closed, 1));
    cache.ensureIdentity('pdfs/a.pdf', 2);
    expect(cache.size).toBe(0);
    expect(closed).toEqual([1]);
  });
});
