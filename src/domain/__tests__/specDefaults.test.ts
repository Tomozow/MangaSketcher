import { describe, expect, test } from 'vitest';

import { defaultTextBox } from '../text';
import {
  DEFAULT_RASTER_HEIGHT,
  DEFAULT_RASTER_WIDTH,
  DEFAULT_TOOL_PROPERTIES,
} from '../types';

describe('§13.1 spec defaults', () => {
  test('defaultTextBox for production raster 1200×1700 is 96×425 (§6, §7.3)', () => {
    expect(DEFAULT_RASTER_WIDTH).toBe(1200);
    expect(DEFAULT_RASTER_HEIGHT).toBe(1700);

    const box = defaultTextBox(DEFAULT_RASTER_WIDTH, DEFAULT_RASTER_HEIGHT);

    // §7.3: round(rw*0.08), round(rh*0.25) → 1200×1700 → 96×425
    expect(box.width).toBe(96);
    expect(box.height).toBe(425);
  });

  test('DEFAULT_TOOL_PROPERTIES.penSize is 12 (§6, §13.1)', () => {
    expect(DEFAULT_TOOL_PROPERTIES.penSize).toBe(12);
  });
});
