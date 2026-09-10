import { describe, expect, test } from 'vitest';
import { drawPageTextsOnThumb, type ThumbText } from '../../web/ink/drawPageTextsOnThumb';
import type { Rect } from '../types';
import { mapIndexAfterNewlineNormalize, normalizeEditNewlines, shouldRotateForVerticalRl, verticalRlCanvasGlyph } from '../text';
import {
  verticalColumnPitch,
  convertWrapToExplicitNewlines,
  expandTextBoxWidthToColumns,
  fitTextBoxToContent,
  layoutVisibleTextBox,
  verticalTextContentSize,
  wrapPageTextToLines,
  verticalCaretCell,
  horizontalCaretCell,
} from '../textWrap';

type Call = { glyph: string; x: number; y: number };

const RASTER_W = 1200;
const RASTER_H = 1700;

/** Run the real renderer at raster scale 1:1 and record fillText calls. */
function renderedCalls(text: ThumbText): Call[] {
  const calls: Call[] = [];
  let ox = 0;
  let oy = 0;
  const stack: { x: number; y: number }[] = [];
  const ctx = {
    save() {
      stack.push({ x: ox, y: oy });
    },
    restore() {
      const prev = stack.pop();
      if (prev) {
        ox = prev.x;
        oy = prev.y;
      }
    },
    beginPath() {},
    rect() {},
    clip() {},
    translate(x: number, y: number) {
      ox += x;
      oy += y;
    },
    rotate() {},
    fillText(glyph: string, x: number, y: number) {
      calls.push({ glyph, x: ox + x, y: oy + y });
    },
    font: '',
    fillStyle: '',
    textBaseline: 'top' as CanvasTextBaseline,
    textAlign: 'center' as CanvasTextAlign,
  };
  drawPageTextsOnThumb(ctx, [text], RASTER_W, RASTER_H, RASTER_W, RASTER_H);
  return calls;
}

/**
 * Reconstruct the exact glyph draw calls implied by the wrapped lines, using
 * the same incremental float operations as the renderer.
 */
function callsFromLines(lines: string[], box: Rect, fontSize: number): Call[] {
  const fontPx = Math.max(1, Number.isFinite(fontSize) ? fontSize : 12);
  const colW = verticalColumnPitch(fontPx);
  const out: Call[] = [];
  let colX = box.x + box.width - colW;
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      colX -= colW;
    }
    let y = box.y;
    for (const glyph of [...lines[i]!]) {
      const gx = colX + colW / 2;
      const drawn = verticalRlCanvasGlyph(glyph);
      if (shouldRotateForVerticalRl(glyph)) {
        out.push({ glyph: drawn, x: gx, y: y + fontPx / 2 });
      } else {
        out.push({ glyph: drawn, x: gx, y });
      }
      y += fontPx;
    }
  }
  return out;
}

function expectParity(content: string, box: Rect, fontSize: number): string[] {
  const laidOut = expandTextBoxWidthToColumns(box, content, fontSize);
  const lines = wrapPageTextToLines(content, laidOut, fontSize);
  const expected = callsFromLines(lines, laidOut, fontSize);
  const actual = renderedCalls({ content, box, fontSize, color: '#000' });
  expect(actual).toEqual(expected);
  return lines;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('wrapPageTextToLines', () => {
  const box: Rect = { x: 100, y: 200, width: 200, height: 120 };

  test('single column when everything fits', () => {
    const lines = expectParity('あいう', box, 36);
    expect(lines).toEqual(['あいう']);
  });

  test('auto-wrap splits at the same glyph as the renderer', () => {
    // height 120 / fontSize 36 → 3 glyphs per column
    const lines = expectParity('あいうえおかきく', box, 36);
    expect(lines).toEqual(['あいう', 'えおか', 'きく']);
  });

  test('explicit \\n forces a new column and mixes with auto-wrap', () => {
    const lines = expectParity('あい\nうえおかき', box, 36);
    expect(lines).toEqual(['あい', 'うえお', 'かき']);
  });

  test('CRLF input treats \\r as invisible', () => {
    const lines = expectParity('あい\r\nうえ', box, 36);
    expect(lines).toEqual(['あい', 'うえ']);
  });

  test('consecutive newlines keep empty columns', () => {
    const lines = expectParity('あ\n\nい', box, 36);
    expect(lines).toEqual(['あ', '', 'い']);
  });

  test('glyphs past the left edge stay visible when the box is widened to 1.5em columns', () => {
    const lines = expectParity('あいうえおかきくけこさしすせそたち', box, 36);
    expect(lines.join('')).toBe('あいうえおかきくけこさしすせそたち');
  });

  test('font larger than box height renders one glyph per column with a leading empty column', () => {
    const tiny: Rect = { x: 0, y: 0, width: 400, height: 20 };
    const lines = expectParity('あい', tiny, 36);
    expect(lines).toEqual(['', 'あ', 'い']);
  });

  test('whitespace-only content renders nothing', () => {
    expect(wrapPageTextToLines('  \n ', box, 36)).toEqual([]);
    expect(renderedCalls({ content: '  \n ', box, fontSize: 36, color: '#000' })).toEqual([]);
  });

  test('degenerate box renders nothing', () => {
    const flat: Rect = { x: 10, y: 10, width: 0, height: 100 };
    expect(wrapPageTextToLines('あ', flat, 36)).toEqual([]);
    expect(renderedCalls({ content: 'あ', box: flat, fontSize: 36, color: '#000' })).toEqual([]);
  });

  test('non-finite font size falls back to 12 like the renderer', () => {
    expectParity('あいうえおかきくけこ', box, Number.NaN);
  });

  test('surrogate pairs are one glyph', () => {
    const lines = expectParity('𠮷あ𠮷', box, 60);
    expect(lines[0]!.length).toBeGreaterThan(0);
    expect([...lines.join('')]).toEqual(['𠮷', 'あ', '𠮷']);
  });

  test('randomized parity against the renderer', () => {
    const rand = mulberry32(20260830);
    const glyphs = ['あ', 'い', '漢', 'ー', 'A', '。', '𠮷', ' ', '\n'];
    for (let i = 0; i < 300; i++) {
      const len = Math.floor(rand() * 40);
      let content = '';
      for (let j = 0; j < len; j++) {
        content += glyphs[Math.floor(rand() * glyphs.length)]!;
      }
      const rBox: Rect = {
        x: rand() * 800,
        y: rand() * 1200,
        width: rand() * 320,
        height: rand() * 400,
      };
      const fontSize = 1 + rand() * 90;
      expectParity(content, rBox, fontSize);
    }
  });
});

describe('convertWrapToExplicitNewlines', () => {
  test('joins wrapped columns with CRLF', () => {
    const box: Rect = { x: 0, y: 0, width: 300, height: 108 };
    expect(convertWrapToExplicitNewlines('あいうえおかき', box, 36)).toBe('あいう\r\nえおか\r\nき');
  });

  test('empty render yields empty string', () => {
    const box: Rect = { x: 0, y: 0, width: 300, height: 108 };
    expect(convertWrapToExplicitNewlines('   ', box, 36)).toBe('');
  });
});

describe('fitTextBoxToContent', () => {
  test('keeps the top-right corner and sizes to glyphs', () => {
    const fontSize = 36;
    const box: Rect = { x: 400, y: 80, width: 200, height: 400 };
    const next = fitTextBoxToContent(box, 'あ', fontSize);
    const size = verticalTextContentSize('あ', fontSize);
    expect(next.width).toBe(size.width);
    expect(next.height).toBe(size.height);
    expect(next.x + next.width).toBeCloseTo(box.x + box.width);
    expect(next.y).toBe(box.y);
  });

  test('typed text grows a single column; 10-glyph wrap is extract-only', () => {
    const fontSize = 36;
    const one = verticalTextContentSize('あ'.repeat(10), fontSize);
    const two = verticalTextContentSize('あ'.repeat(11), fontSize);
    expect(two.width).toBe(one.width);
    expect(two.width).toBe(Math.ceil(verticalColumnPitch(fontSize)));
    expect(one.height).toBe(10 * fontSize);
    expect(two.height).toBe(11 * fontSize);
    expect(verticalTextContentSize('あ', fontSize).height).toBe(fontSize);
    expect(verticalTextContentSize('あ'.repeat(3), fontSize).height).toBe(3 * fontSize);
    expect(verticalTextContentSize(`${'あ'.repeat(10)}\nあ`, fontSize).width).toBe(
      Math.ceil(2 * verticalColumnPitch(fontSize)),
    );
  });

  test('empty content leaves the box unchanged', () => {
    const box: Rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(fitTextBoxToContent(box, '   ', 36)).toEqual(box);
  });
});

describe('expandTextBoxWidthToColumns', () => {
  test('widens a 1.2em box to 1.5em for a single column', () => {
    const fontSize = 36;
    const box: Rect = { x: 400, y: 80, width: Math.ceil(fontSize * 1.2), height: fontSize };
    const next = expandTextBoxWidthToColumns(box, 'あ', fontSize);
    expect(next.width).toBe(Math.ceil(verticalColumnPitch(fontSize)));
    expect(next.x + next.width).toBeCloseTo(box.x + box.width);
    expect(next.y).toBe(box.y);
    expect(next.height).toBe(box.height);
  });

  test('does not widen a zero-width box', () => {
    const box: Rect = { x: 10, y: 20, width: 0, height: 40 };
    expect(expandTextBoxWidthToColumns(box, 'あ', 36)).toEqual(box);
  });

  test('leaves a wide enough box unchanged', () => {
    const fontSize = 36;
    const box: Rect = { x: 10, y: 20, width: 200, height: fontSize };
    expect(expandTextBoxWidthToColumns(box, 'あ', fontSize)).toEqual(box);
  });
});

describe('verticalCaretCell', () => {
  test('empty content is the top of the first column', () => {
    expect(verticalCaretCell('', 0, { x: 0, y: 0, width: 40, height: 80 }, 20)).toEqual({
      column: 0,
      row: 0,
    });
  });

  test('newline starts the next column at row 0', () => {
    const font = 20;
    const colW = font * 1.5;
    const box: Rect = { x: 0, y: 0, width: colW * 4, height: font * 10 };
    expect(verticalCaretCell('あい\n', 3, box, font)).toEqual({ column: 1, row: 0 });
    expect(verticalCaretCell('あい\n\n', 4, box, font)).toEqual({ column: 2, row: 0 });
  });

  test('CRLF caret matches LF after normalize', () => {
    const font = 20;
    const colW = font * 1.5;
    const box: Rect = { x: 0, y: 0, width: colW * 4, height: font * 10 };
    const raw = 'あい\r\n';
    const value = normalizeEditNewlines(raw);
    expect(value).toBe('あい\n');
    expect(mapIndexAfterNewlineNormalize(raw, raw.length)).toBe(value.length);
    expect(verticalCaretCell(value, value.length, box, font)).toEqual({ column: 1, row: 0 });
  });

  test('hugged 1–3 glyph boxes stay in column 0', () => {
    const font = 15.14;
    for (const n of [1, 2, 3]) {
      const text = 'あ'.repeat(n);
      const box = layoutVisibleTextBox({ x: 0, y: 0, width: font * 1.5, height: font }, text, font);
      expect(verticalCaretCell(text, n, { x: 0, y: 0, width: box.width, height: box.height }, font)).toEqual({
        column: 0,
        row: n,
      });
    }
  });
});

describe('horizontal wrap', () => {
  const box: Rect = { x: 10, y: 20, width: 108, height: 200 };

  test('wraps by width into rows', () => {
    expect(wrapPageTextToLines('あいうえおかきく', box, 36, 'horizontal')).toEqual(['あいう', 'えおか', 'きく']);
  });

  test('fitTextBoxToContent keeps the top-left corner', () => {
    const fontSize = 36;
    const start: Rect = { x: 100, y: 50, width: 20, height: 20 };
    const next = fitTextBoxToContent(start, 'あい', fontSize, 'horizontal');
    expect(next.x).toBe(100);
    expect(next.y).toBe(50);
    expect(next.width).toBe(72);
    expect(next.height).toBe(Math.ceil(verticalColumnPitch(fontSize)));
  });

  test('horizontalCaretCell walks left to right then down', () => {
    const rowBox: Rect = { x: 0, y: 0, width: 108, height: 200 };
    expect(horizontalCaretCell('あいうえ', 0, rowBox, 36)).toEqual({ column: 0, row: 0 });
    expect(horizontalCaretCell('あいうえ', 3, rowBox, 36)).toEqual({ column: 3, row: 0 });
    expect(horizontalCaretCell('あいうえ', 4, rowBox, 36)).toEqual({ column: 1, row: 1 });
  });
});
