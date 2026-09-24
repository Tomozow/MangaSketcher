import { afterEach, describe, expect, test } from 'vitest';
import { publicUrl } from '@/src/web/publicUrl';

describe('publicUrl', () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = previous;
    }
  });

  test('local and user-site builds stay at the origin root', () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    expect(publicUrl('/sw.js')).toBe('/sw.js');
    expect(publicUrl('/')).toBe('/');
  });

  test('project pages prefix public files and the home path', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/MangaSketcher';
    expect(publicUrl('/page_template.jpg')).toBe('/MangaSketcher/page_template.jpg');
    expect(publicUrl('/')).toBe('/MangaSketcher/');
    process.env.NEXT_PUBLIC_BASE_PATH = 'MangaSketcher/';
    expect(publicUrl('/sw.js')).toBe('/MangaSketcher/sw.js');
  });
});
