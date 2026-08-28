import { describe, expect, test } from 'vitest';

import {
  APPEND_W,
  buildStripFrames,
  hitStripFrame,
  pageLocalFromWorld,
  PAGE_DISPLAY_H,
  PAGE_DISPLAY_W,
  STRIP_GAP,
} from '../stripGeometry';
import { createDocument, sequentialIds } from '../document';

describe('stripGeometry 216×306 hit tests', () => {
  test('PAGE_DISPLAY は 216×306', () => {
    expect(PAGE_DISPLAY_W).toBe(216);
    expect(PAGE_DISPLAY_H).toBe(306);
  });

  test('append フレームの中心をヒットする', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 2,
      ids: sequentialIds('pg'),
    });
    const { frames } = buildStripFrames(doc.workspaceOrder);
    const append = frames.find((f) => f.slot.kind === 'append');
    expect(append).toBeTruthy();
    const cx = append!.x + APPEND_W / 2;
    const cy = append!.y + PAGE_DISPLAY_H / 2;
    const hit = hitStripFrame(frames, cx, cy);
    expect(hit?.slot.kind).toBe('append');
  });

  test('ページフレーム内をヒットし pageLocalFromWorld は 1200×1700 に写像', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 3,
      rasterWidth: 1200,
      rasterHeight: 1700,
      ids: sequentialIds('pg'),
    });
    const { frames } = buildStripFrames(doc.workspaceOrder);
    const pageFrame = frames.find((f) => f.slot.kind === 'page');
    expect(pageFrame).toBeTruthy();
    const localX = pageFrame!.x + PAGE_DISPLAY_W / 2;
    const localY = pageFrame!.y + PAGE_DISPLAY_H / 2;
    const hit = hitStripFrame(frames, localX, localY);
    expect(hit?.slot.kind).toBe('page');
    const mapped = pageLocalFromWorld(pageFrame!, localX, localY, 1200, 1700);
    expect(mapped.x).toBeCloseTo(600, 0);
    expect(mapped.y).toBeCloseTo(850, 0);
  });

  test('フレーム幅は 216 で append 後に gap', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    const { frames, contentWidth } = buildStripFrames(doc.workspaceOrder);
    const pageFrame = frames.find((f) => f.slot.kind === 'page');
    expect(pageFrame?.width).toBe(216);
    expect(pageFrame?.height).toBe(306);
    expect(frames[0].width).toBe(APPEND_W);
    expect(frames[1].x).toBe(APPEND_W + STRIP_GAP);
    expect(contentWidth).toBeGreaterThan(APPEND_W + STRIP_GAP + PAGE_DISPLAY_W);
  });
});
