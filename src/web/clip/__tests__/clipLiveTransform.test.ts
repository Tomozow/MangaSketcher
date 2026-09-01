import { describe, expect, test } from 'vitest';
import { effectiveClipPose, mergeClipLive } from '../clipLiveTransform';

describe('clipLiveTransform', () => {
  const clip = { id: 'c1', rasterId: 'r1', x: 10, y: 20, scale: 1, rotation: 0 };

  test('mergeClipLive patches only provided fields', () => {
    expect(mergeClipLive(clip, undefined, { x: 30 })).toEqual({
      x: 30,
      y: 20,
      scale: 1,
      scaleY: 1,
      rotation: 0,
    });
    expect(mergeClipLive(clip, { x: 30, y: 40, scale: 1, scaleY: 1, rotation: 0 }, { scale: 1.5 })).toEqual({
      x: 30,
      y: 40,
      scale: 1.5,
      scaleY: 1,
      rotation: 0,
    });
  });

  test('effectiveClipPose prefers live values', () => {
    expect(effectiveClipPose(clip, { x: 5, y: 6, scale: 2, scaleY: 3, rotation: 0.1 })).toEqual({
      x: 5,
      y: 6,
      scale: 2,
      scaleY: 3,
      rotation: 0.1,
    });
  });
});
