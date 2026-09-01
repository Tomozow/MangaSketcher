import { describe, expect, test } from 'vitest';

import { assignOverlappingTextsToClips, restoreAttachedTextBoxes, attachedTextsToClipRasterTexts } from '../stockClipAttach';

describe('assignOverlappingTextsToClips', () => {
  test('bundles overlapping texts onto the clip and leaves the rest', () => {
    const result = assignOverlappingTextsToClips(
      [
        {
          clipId: 'c1',
          originX: 10,
          originY: 20,
          hitBox: { x: 10, y: 20, width: 40, height: 30 },
        },
      ],
      [
        { textId: 't-on', box: { x: 20, y: 25, width: 8, height: 12 } },
        { textId: 't-off', box: { x: 200, y: 200, width: 8, height: 12 } },
      ],
    );
    expect(result.leftoverTextIds).toEqual(['t-off']);
    expect(result.attachedByClip.get('c1')).toEqual([
      { textId: 't-on', offsetX: 10, offsetY: 5 },
    ]);
  });

  test('assigns a text that overlaps two clips to the first clip', () => {
    const result = assignOverlappingTextsToClips(
      [
        { clipId: 'c1', originX: 0, originY: 0, hitBox: { x: 0, y: 0, width: 20, height: 20 } },
        { clipId: 'c2', originX: 10, originY: 0, hitBox: { x: 10, y: 0, width: 20, height: 20 } },
      ],
      [{ textId: 't1', box: { x: 12, y: 4, width: 4, height: 4 } }],
    );
    expect(result.attachedByClip.get('c1')).toEqual([{ textId: 't1', offsetX: 12, offsetY: 4 }]);
    expect(result.attachedByClip.get('c2')).toEqual([]);
    expect(result.leftoverTextIds).toEqual([]);
  });
});

describe('restoreAttachedTextBoxes', () => {
  test('moves bundled texts by the clip origin delta', () => {
    const texts = [{ id: 't1', box: { x: 20, y: 25, width: 8, height: 12 } }];
    restoreAttachedTextBoxes(texts, 40, 50, [{ textId: 't1', offsetX: 10, offsetY: 5 }]);
    expect(texts[0]!.box).toEqual({ x: 50, y: 55, width: 8, height: 12 });
  });
});

describe('attachedTextsToClipRasterTexts', () => {
  test('converts workspace offsets into clip raster boxes', () => {
    const texts = attachedTextsToClipRasterTexts(
      [{ textId: 't1', offsetX: 21.6, offsetY: 30.6 }],
      [
        {
          id: 't1',
          content: 'あ',
          box: { x: 0, y: 0, width: 21.6, height: 61.2 },
          fontSize: 40,
          color: '#111',
        },
      ],
      1,
      { width: 200, height: 100 },
      1200,
      1700,
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]!.box.x).toBeCloseTo(120);
    expect(texts[0]!.box.y).toBeCloseTo(170);
    expect(texts[0]!.box.width).toBeCloseTo(120);
    expect(texts[0]!.box.height).toBeCloseTo(340);
    expect(texts[0]!.fontSize).toBeCloseTo(40);
  });

  test('divides font and offsets by clip scale', () => {
    const texts = attachedTextsToClipRasterTexts(
      [{ textId: 't1', offsetX: 21.6, offsetY: 0 }],
      [
        {
          id: 't1',
          content: 'あ',
          box: { x: 0, y: 0, width: 21.6, height: 30.6 },
          fontSize: 40,
          color: '#111',
        },
      ],
      2,
      { width: 200, height: 100 },
      1200,
      1700,
    );
    expect(texts[0]!.box.x).toBeCloseTo(60);
    expect(texts[0]!.fontSize).toBeCloseTo(20);
  });
});
