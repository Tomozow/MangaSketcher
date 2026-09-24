import { afterEach, describe, expect, test } from 'vitest';
import {
  isValidProjectId,
  legacyProjectIdFromPathname,
  projectHref,
  projectIdFromSearchParam,
} from '../projectRoutes';

describe('projectRoutes', () => {
  const previousBase = process.env.NEXT_PUBLIC_BASE_PATH;

  afterEach(() => {
    if (previousBase === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = previousBase;
    }
  });

  test('projectHref uses a query id so static hosts can serve one editor page', () => {
    expect(projectHref('abc-123')).toBe('/p/?id=abc-123');
  });

  test('projectHref keeps the trailing slash under a Pages base path', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/MangaSketcher';
    expect(projectHref('abc-123')).toBe('/MangaSketcher/p/?id=abc-123');
    expect(legacyProjectIdFromPathname('/MangaSketcher/p/abc-123')).toBe('abc-123');
  });

  test('rejects empty or oversized ids', () => {
    expect(isValidProjectId('')).toBe(false);
    expect(isValidProjectId('x'.repeat(129))).toBe(false);
    expect(isValidProjectId('ok_id-1')).toBe(true);
  });

  test('reads the query id', () => {
    expect(projectIdFromSearchParam('  p1  ')).toBe('p1');
    expect(projectIdFromSearchParam('bad id')).toBeNull();
    expect(projectIdFromSearchParam(null)).toBeNull();
  });

  test('recovers legacy /p/:id pathnames', () => {
    expect(legacyProjectIdFromPathname('/p/abc-123')).toBe('abc-123');
    expect(legacyProjectIdFromPathname('/p/abc-123/')).toBe('abc-123');
    expect(legacyProjectIdFromPathname('/p')).toBeNull();
    expect(legacyProjectIdFromPathname('/p?id=abc-123')).toBeNull();
  });
});
