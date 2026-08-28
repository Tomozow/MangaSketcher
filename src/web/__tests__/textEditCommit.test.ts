import { describe, expect, test } from 'vitest';
import { planTextCommit } from '../textEditCommit';

describe('planTextCommit (§3.4)', () => {
  test('commits only on explicit request after composition with changes', () => {
    expect(
      planTextCommit({
        draft: 'あい',
        savedContent: '',
        composing: false,
        explicit: true,
      }),
    ).toEqual({ kind: 'commit', content: 'あい' });
  });

  test('commits on 完了 even while composing', () => {
    expect(
      planTextCommit({
        draft: 'あ',
        savedContent: '',
        composing: true,
        explicit: true,
        forceOnExplicit: true,
      }),
    ).toEqual({ kind: 'commit', content: 'あ' });
  });

  test('skips blur while composing', () => {
    expect(
      planTextCommit({
        draft: 'あ',
        savedContent: '',
        composing: true,
        explicit: true,
      }),
    ).toEqual({ kind: 'skip', reason: 'composing' });
  });

  test('does not commit on viewport-only paths (non-explicit)', () => {
    expect(
      planTextCommit({
        draft: 'あ',
        savedContent: '',
        composing: false,
        explicit: false,
      }),
    ).toEqual({ kind: 'skip', reason: 'not-explicit' });
  });

  test('skips unchanged draft', () => {
    expect(
      planTextCommit({
        draft: '同じ',
        savedContent: '同じ',
        composing: false,
        explicit: true,
      }),
    ).toEqual({ kind: 'skip', reason: 'unchanged' });
  });
});
