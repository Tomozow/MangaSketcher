import { describe, expect, test } from 'vitest';
import {
  fitTextEditInputHeight,
  planTextCommit,
  TEXT_EDIT_GAP_PX,
  TEXT_EDIT_MIN_HEIGHT_PX,
  textEditBarPose,
  textEditHudPose,
  hudScreenFontPx,
} from '../textEditCommit';

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

  test('skips blur while composing unless forced', () => {
    expect(
      planTextCommit({
        draft: 'あ',
        savedContent: '',
        composing: true,
        explicit: true,
      }),
    ).toEqual({ kind: 'skip', reason: 'composing' });
  });

  test('forced focusout commits even while composing', () => {
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

  test('commits empty draft so the box can be deleted', () => {
    expect(
      planTextCommit({
        draft: '',
        savedContent: '',
        composing: false,
        explicit: true,
      }),
    ).toEqual({ kind: 'commit', content: '' });
    expect(
      planTextCommit({
        draft: '   ',
        savedContent: '   ',
        composing: false,
        explicit: true,
      }),
    ).toEqual({ kind: 'commit', content: '   ' });
  });
});

describe('textEditBarPose', () => {
  test('places the bar below the selected wrap', () => {
    expect(
      textEditBarPose(
        { left: 100, top: 80, right: 140, bottom: 200, width: 40, height: 120 },
        { left: 0, top: 0, width: 800, height: 600 },
        52,
      ),
    ).toEqual({ left: 100, top: 200 + TEXT_EDIT_GAP_PX, width: 240 });
  });

  test('clamps into the visual viewport when the wrap is near the bottom', () => {
    const pose = textEditBarPose(
      { left: 20, top: 540, right: 80, bottom: 590, width: 60, height: 50 },
      { left: 0, top: 0, width: 400, height: 600 },
      52,
    );
    expect(pose.top + 52).toBeLessThanOrEqual(600 - 8);
    expect(pose.left).toBeGreaterThanOrEqual(8);
  });
});

describe('textEditHudPose', () => {
  test('matches the wrap in screen space', () => {
    expect(
      textEditHudPose(
        { left: 120, top: 80, width: 48, height: 200 },
        { left: 0, top: 0, width: 800, height: 600 },
      ),
    ).toEqual({ left: 120, top: 80, width: 48, height: 200 });
  });

  test('stays on the wrap even when the visual viewport is smaller than the wrap', () => {
    const pose = textEditHudPose(
      { left: 20, top: 540, width: 60, height: 200 },
      { left: 0, top: 0, width: 400, height: 450 },
    );
    expect(pose).toEqual({ left: 20, top: 540, width: 60, height: 200 });
  });
});

describe('hudScreenFontPx', () => {
  test('scales CSS font-size by wrap screen size', () => {
    expect(hudScreenFontPx(4.5, 32, 129.4217529296875)).toBeCloseTo(18.199934005737305);
    expect(hudScreenFontPx(4.5, 0, 100)).toBe(4.5);
  });
});

describe('fitTextEditInputHeight', () => {
  test('grows with the draft and does not shrink below the tap target', () => {
    expect(fitTextEditInputHeight(20)).toBe(TEXT_EDIT_MIN_HEIGHT_PX);
    expect(fitTextEditInputHeight(120)).toBe(120);
  });

  test('clamps to the viewport budget so long extracts stay visible but on screen', () => {
    expect(fitTextEditInputHeight(800, TEXT_EDIT_MIN_HEIGHT_PX, 200)).toBe(200);
  });
});
