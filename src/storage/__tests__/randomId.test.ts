import { describe, expect, test } from 'vitest';
import { randomId } from '../randomId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('randomId', () => {
  test('returns RFC4122 version 4 shape', () => {
    expect(randomId()).toMatch(UUID_V4);
  });

  test('falls back when randomUUID is missing', () => {
    const original = crypto.randomUUID;
    // @ts-expect-error test insecure-context gap
    crypto.randomUUID = undefined;
    try {
      expect(randomId()).toMatch(UUID_V4);
    } finally {
      crypto.randomUUID = original;
    }
  });
});
