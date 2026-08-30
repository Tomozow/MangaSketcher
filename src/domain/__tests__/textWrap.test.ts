import { describe, expect, test } from 'vitest';
import { drawPageTextsOnThumb, type ThumbText } from '../../web/ink/drawPageTextsOnThumb';
import type { Rect } from '../types';
import {
  TEXT_WRAP_LINE_HEIGHT,
  convertWrapToExplicitNewlines,
  wrapPageTextToLines,
} from '../textWrap';

type Call = { glyph: string; x: number; y: number };

const RASTER_W = 1200;
const RASTER_H = 1700;

/** Run the real renderer at raster scale 1:1 and record fillText calls. */
function renderedCalls(text: ThumbText): Call[] {
  const calls: Call[] = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillText(glyph: string, x: number, y: number) {
      calls.push({ glyph, x, y });
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
  const colW = fontPx * TEXT_WRAP_LINE_HEIGHT;
  const out: Call[] = [];
  let colX = box.x + box.width - colW;
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      colX -= colW;
    }
    let y = box.y;
    for (const glyph of [...lines[i]!]) {
      out.push({ glyph, x: colX + colW / 2, y });
      y += fontPx;
    }
  }
  return out;
}

function expectParity(content: string, box: Rect, fontSize: number): string[] {
  const lines = wrapPageTextToLines(content, box, fontSize);
  const expected = callsFromLines(lines, box, fontSize);
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

  test('glyphs past the left edge are dropped like the renderer', () => {
    // colW 43.2, break when the whole column exits box.x → 5 columns × 3 glyphs
    const lines = expectParity('あいうえおかきくけこさしすせそたち', box, 36);
    expect(lines.join('')).toBe('あいうえおかきくけこさしすせそ');
    expect(lines).toHaveLength(5);
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
