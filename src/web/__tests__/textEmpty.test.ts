import { describe, expect, test } from 'vitest';
import { isTextContentEmpty } from '../../domain/text';

describe('isTextContentEmpty', () => {
  test('空文字・空白のみは true', () => {
    expect(isTextContentEmpty('')).toBe(true);
    expect(isTextContentEmpty('   ')).toBe(true);
    expect(isTextContentEmpty('\n\t')).toBe(true);
  });

  test('文字があれば false', () => {
    expect(isTextContentEmpty('あ')).toBe(false);
    expect(isTextContentEmpty('  x ')).toBe(false);
  });
});
