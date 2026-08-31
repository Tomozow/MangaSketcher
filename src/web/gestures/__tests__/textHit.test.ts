import { describe, expect, test } from 'vitest';
import { PAGE_DISPLAY_H, PAGE_DISPLAY_W } from '../../../domain/stripGeometry';
import { expandTextHitBox, TEXT_HIT_PAD_CSS } from '../textHit';

describe('expandTextHitBox', () => {
  test('pads the raster box by 5 CSS px on every side', () => {
    const rasterWidth = 1200;
    const rasterHeight = 1700;
    const box = { x: 100, y: 200, width: 40, height: 80 };
    const hit = expandTextHitBox(box, rasterWidth, rasterHeight);
    const padX = (TEXT_HIT_PAD_CSS / PAGE_DISPLAY_W) * rasterWidth;
    const padY = (TEXT_HIT_PAD_CSS / PAGE_DISPLAY_H) * rasterHeight;
    expect(hit.x).toBeCloseTo(box.x - padX);
    expect(hit.y).toBeCloseTo(box.y - padY);
    expect(hit.width).toBeCloseTo(box.width + padX * 2);
    expect(hit.height).toBeCloseTo(box.height + padY * 2);
  });
});
