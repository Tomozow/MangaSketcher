import { describe, expect, test } from 'vitest';
import { pageTextCanvasFont } from '../../pageTextFont';
import { THUMB_HEIGHT, THUMB_WIDTH } from '../InkEngine';
import { drawPageTextsOnThumb } from '../drawPageTextsOnThumb';

type Fill = { text: string; x: number; y: number; font: string; fillStyle: string };

function recordingContext() {
  const fills: Fill[] = [];
  const ctx = {
    font: '',
    fillStyle: '',
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    textAlign: 'start' as CanvasTextAlign,
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y, font: ctx.font, fillStyle: ctx.fillStyle });
    },
  };
  return { ctx, fills };
}

describe('drawPageTextsOnThumb', () => {
  test('skips empty content', () => {
    const { ctx, fills } = recordingContext();
    drawPageTextsOnThumb(
      ctx,
      [{ content: '   ', box: { x: 0, y: 0, width: 100, height: 200 }, fontSize: 20, color: '#000' }],
      1200,
      1700,
      THUMB_WIDTH,
      THUMB_HEIGHT,
    );
    expect(fills).toEqual([]);
  });

  test('stacks vertical-rl glyphs from the right of the box', () => {
    const { ctx, fills } = recordingContext();
    drawPageTextsOnThumb(
      ctx,
      [
        {
          content: 'あいう',
          box: { x: 1000, y: 100, width: 80, height: 400 },
          fontSize: 40,
          color: '#1A1A1A',
        },
      ],
      1200,
      1700,
      THUMB_WIDTH,
      THUMB_HEIGHT,
    );
    expect(fills.map((f) => f.text)).toEqual(['あ', 'い', 'う']);
    expect(fills[0]!.y).toBeLessThan(fills[1]!.y);
    expect(fills[1]!.y).toBeLessThan(fills[2]!.y);
    expect(fills[0]!.x).toBeCloseTo(fills[1]!.x);
    expect(fills[0]!.fillStyle).toBe('#1A1A1A');
    expect(fills[0]!.font).toBe(pageTextCanvasFont(40 * (THUMB_WIDTH / 1200)));
  });

  test('newline starts a new column to the left', () => {
    const { ctx, fills } = recordingContext();
    drawPageTextsOnThumb(
      ctx,
      [
        {
          content: 'あ\nい',
          box: { x: 0, y: 0, width: 200, height: 400 },
          fontSize: 40,
          color: '#000',
        },
      ],
      1200,
      1700,
      THUMB_WIDTH,
      THUMB_HEIGHT,
    );
    expect(fills.map((f) => f.text)).toEqual(['あ', 'い']);
    expect(fills[1]!.x).toBeLessThan(fills[0]!.x);
    expect(fills[1]!.y).toBeCloseTo(fills[0]!.y);
  });

  test('export dest=raster keeps fontSize unscaled', () => {
    const { ctx, fills } = recordingContext();
    drawPageTextsOnThumb(
      ctx,
      [
        {
          content: 'あ',
          box: { x: 100, y: 100, width: 80, height: 400 },
          fontSize: 40,
          color: '#000',
        },
      ],
      1200,
      1700,
      1200,
      1700,
    );
    expect(fills[0]!.font).toBe(pageTextCanvasFont(40));
  });

  test('fixed corpus draws without throwing', () => {
    const { ctx } = recordingContext();
    expect(() =>
      drawPageTextsOnThumb(
        ctx,
        [
          {
            content: 'セリフ',
            box: { x: 900, y: 100, width: 80, height: 400 },
            fontSize: 36,
            color: '#1A1A1A',
          },
          {
            content: 'あ\nい\r\nう',
            box: { x: 100, y: 50, width: 120, height: 800 },
            fontSize: 24,
            color: '#000',
          },
          {
            content: '   ',
            box: { x: 0, y: 0, width: 10, height: 10 },
            fontSize: 12,
            color: '#000',
          },
        ],
        1200,
        1700,
        1200,
        1700,
      ),
    ).not.toThrow();
  });
});
