import { describe, expect, test } from 'vitest';

import { defaultTextBox } from '../text';
import { PAGE_DISPLAY_W, TEXT_CHROME_BUTTON_PAGE_RATIO, TEXT_CHROME_STACK_PX, textChromeScreenMetrics } from '../stripGeometry';
import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  DEFAULT_TOOL_PROPERTIES,
} from '../types';

describe('§13.1 spec defaults', () => {
  test('defaultTextBox is one glyph cell until content grows', () => {
    expect(DEFAULT_RASTER_WIDTH).toBe(1200);
    expect(DEFAULT_RASTER_HEIGHT).toBe(1700);

    const font = DEFAULT_TOOL_PROPERTIES.textFontSize;
    const box = defaultTextBox(DEFAULT_RASTER_WIDTH, DEFAULT_RASTER_HEIGHT, font);

    expect(box.width).toBe(Math.ceil(font * 1.5));
    expect(box.height).toBe(font);
  });

  test('DEFAULT_TOOL_PROPERTIES.penSize is 12 (§6, §13.1)', () => {
    expect(DEFAULT_TOOL_PROPERTIES.penSize).toBe(12);
  });

  test('text chrome origin sits above the text box, not inside it', () => {
    expect(PAGE_DISPLAY_W * TEXT_CHROME_BUTTON_PAGE_RATIO).toBeCloseTo(30);
    expect(textChromeScreenMetrics(PAGE_DISPLAY_W).button).toBeCloseTo(30);
    expect(textChromeScreenMetrics(PAGE_DISPLAY_W).stack).toBeCloseTo(TEXT_CHROME_STACK_PX);
    expect(textChromeScreenMetrics(PAGE_DISPLAY_W * 2).button).toBeCloseTo(30);
  });
});
