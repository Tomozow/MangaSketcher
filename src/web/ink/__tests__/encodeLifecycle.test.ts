import { describe, expect, test, vi } from 'vitest';

import { FakeOffscreenCanvas } from '../fakeCanvas';
import { InkEngine } from '../InkEngine';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function engine(encodePng: () => Promise<ArrayBuffer>) {
  const e = new InkEngine({
    rasterWidth: 8,
    rasterHeight: 8,
    emptyPng: new ArrayBuffer(0),
    canvasFactory: (w, h) => new FakeOffscreenCanvas(w, h) as unknown as OffscreenCanvas,
    encodePng,
  });
  e.registerRaster('p:clip:c');
  e.decode('p:clip:c');
  return e;
}

describe('encode lifecycle notifications', () => {
  test('disposing a raster mid-encode aborts instead of leaving it encoding', async () => {
    const aborted = vi.fn();
    const e = engine(() => new Promise(() => {}));
    e.setCallbacks({ onEncodingAborted: aborted });
    e.beginEraseDirect('p:clip:c');
    e.finishEraseDirect('p:clip:c');
    e.disposeRaster('p:clip:c');
    expect(aborted).toHaveBeenCalledWith('p:clip:c');
  });

  test('a rejected encode is retried, then reported as failed', async () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const encode = vi.fn(async () => {
      throw new Error('blob');
    });
    const e = engine(encode);
    e.setCallbacks({ onEncodingFailed: failed });
    e.beginEraseDirect('p:clip:c');
    e.finishEraseDirect('p:clip:c');
    await vi.advanceTimersByTimeAsync(5000);
    expect(encode).toHaveBeenCalledTimes(3);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(e.isEncoding('p:clip:c')).toBe(false);
    vi.useRealTimers();
  });

  test('a transient failure recovers without reporting failure', async () => {
    vi.useFakeTimers();
    const failed = vi.fn();
    const complete = vi.fn();
    let n = 0;
    const e = engine(async () => {
      if (++n === 1) throw new Error('once');
      return PNG;
    });
    e.setCallbacks({ onEncodingFailed: failed, onEncodingComplete: complete });
    e.beginEraseDirect('p:clip:c');
    e.finishEraseDirect('p:clip:c');
    await vi.advanceTimersByTimeAsync(2000);
    expect(failed).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
