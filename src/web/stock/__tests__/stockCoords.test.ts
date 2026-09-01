import { describe, expect, test } from 'vitest';
import { clientToStockWorld } from '../stockCoords';

function rect(left: number, top: number): DOMRect {
  return { left, top, right: left + 400, bottom: top + 200, width: 400, height: 200, x: left, y: top, toJSON: () => ({}) };
}

describe('clientToStockWorld', () => {
  test('grab offset keeps the grabbed point under the pointer', () => {
    const surface = rect(10, 20);
    const grab = { x: 40, y: 50 };
    const stay = clientToStockWorld(50, 70, surface, 0, 0, 1, 'free', { width: 72, height: 102 }, grab);
    expect(stay).toEqual({ x: 0, y: 0 });
    const moved = clientToStockWorld(90, 110, surface, 0, 0, 1, 'free', { width: 72, height: 102 }, grab);
    expect(moved).toEqual({ x: 40, y: 40 });
  });

  test('without grab offset the pointer is treated as the item center', () => {
    const surface = rect(0, 0);
    const dropped = clientToStockWorld(36, 51, surface, 0, 0, 1, 'free', { width: 72, height: 102 });
    expect(dropped).toEqual({ x: 0, y: 0 });
  });
});
