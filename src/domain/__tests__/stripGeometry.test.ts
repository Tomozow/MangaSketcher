import { describe, expect, test } from 'vitest';

import {
  APPEND_W,
  buildStripFrames,
  clampRasterPoint,
  hitStripFrame,
  pageLocalFromWorld,
  PAGE_DISPLAY_H,
  PAGE_DISPLAY_W,
  PAGE_NUMBER_BAND,
  SPREAD_INNER_GAP,
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

  test('隣ページ上の world を元ページへ写すと端にクランプされ反対側には飛ばない', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 2,
      rasterWidth: 1200,
      rasterHeight: 1700,
      ids: sequentialIds('pg'),
    });
    const { frames } = buildStripFrames(doc.workspaceOrder);
    const pageFrames = frames.filter((f) => f.slot.kind === 'page');
    expect(pageFrames.length).toBe(2);
    const left = pageFrames[0]!;
    const right = pageFrames[1]!;
    const neighborWorldX = right.x + 4;
    const neighborWorldY = right.y + PAGE_DISPLAY_H / 2;
    const raw = pageLocalFromWorld(left, neighborWorldX, neighborWorldY, 1200, 1700);
    expect(raw.x).toBeGreaterThan(1200);
    const clamped = clampRasterPoint(raw.x, raw.y, 1200, 1700);
    expect(clamped.x).toBe(1200);
    expect(clamped.x).not.toBeCloseTo(0, 0);
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
    const append = frames.find((f) => f.slot.kind === 'append');
    expect(append?.width).toBe(APPEND_W);
    expect(append?.x).toBe(0);
    expect(append?.y).toBe(0);
    expect(pageFrame?.x).toBe(APPEND_W + STRIP_GAP);
    expect(contentWidth).toBeGreaterThan(APPEND_W + STRIP_GAP + PAGE_DISPLAY_W);
  });

  test('番号帯の左端付近は + ではなくページ番号として当たる', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 2,
      ids: sequentialIds('pg'),
    });
    const { frames } = buildStripFrames(doc.workspaceOrder);
    const pageFrame = frames.find((f) => f.slot.kind === 'page')!;
    const hit = hitStripFrame(
      frames,
      pageFrame.x - 4,
      pageFrame.y + PAGE_DISPLAY_H + PAGE_NUMBER_BAND / 2,
    );
    expect(hit?.slot.kind).toBe('page');
    if (hit?.slot.kind === 'page') {
      expect(hit.slot.pageId).toBe(pageFrame.slot.kind === 'page' ? pageFrame.slot.pageId : '');
    }
  });

  test('1列1見開きは [1][余白]、[3][2]、[5][4] で折り返す', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 5,
      ids: sequentialIds('pg'),
    });
    const { frames, contentHeight } = buildStripFrames(doc.workspaceOrder, {
      pagesPerColumn: 1,
    });
    const pageFrames = frames.filter((f) => f.slot.kind === 'page' || f.slot.kind === 'blank');
    const ys = [...new Set(pageFrames.map((f) => f.y))].sort((a, b) => a - b);
    expect(ys.length).toBe(3);
    expect(contentHeight).toBeGreaterThan(PAGE_DISPLAY_H * 2);
    expect(
      pageFrames
        .filter((f) => f.y === ys[0])
        .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白')),
    ).toEqual([1, '余白']);
    expect(
      pageFrames
        .filter((f) => f.y === ys[1])
        .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白')),
    ).toEqual([3, 2]);
    expect(
      pageFrames
        .filter((f) => f.y === ys[2])
        .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白')),
    ).toEqual([5, 4]);
    expect(pageFrames.filter((f) => f.slot.kind === 'blank')).toHaveLength(1);
    const blank = pageFrames.find((f) => f.slot.kind === 'blank')!;
    const page2 = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 2)!;
    expect(page2.x).toBe(blank.x);
    expect(page2.y).toBe(ys[1]);
    const append = frames.find((f) => f.slot.kind === 'append');
    expect(append?.y).toBe(ys[ys.length - 1]);
    const lastPage = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 5)!;
    expect(append?.x).toBe(lastPage.x - STRIP_GAP - APPEND_W);
  });

  test('見開きの間の余白・仕切りと列の縦余白をフレーム座標に反映する', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 4,
      ids: sequentialIds('pg'),
    });
    const pairGap = 40;
    const columnGap = PAGE_DISPLAY_H;
    const { frames, dividers } = buildStripFrames(doc.workspaceOrder, {
      pagesPerColumn: 3,
      pairGap,
      showPairDivider: true,
      columnGap,
    });
    const firstRow = frames
      .filter((f) => f.y === 0 && f.slot.kind !== 'append')
      .sort((a, b) => a.x - b.x);
    expect(firstRow.map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白'))).toEqual([
      3, 2, 1, '余白',
    ]);
    expect(firstRow[1]!.x - (firstRow[0]!.x + PAGE_DISPLAY_W)).toBe(SPREAD_INNER_GAP);
    expect(firstRow[2]!.x - (firstRow[1]!.x + PAGE_DISPLAY_W)).toBe(pairGap);
    expect(firstRow[3]!.x - (firstRow[2]!.x + PAGE_DISPLAY_W)).toBe(SPREAD_INNER_GAP);
    expect(dividers).toHaveLength(1);
    expect(dividers[0]!.x).toBe(firstRow[1]!.x + PAGE_DISPLAY_W + pairGap / 2);
    const secondRow = frames.filter((f) => f.y > 0 && f.slot.kind !== 'append');
    expect(secondRow[0]!.y).toBe(PAGE_DISPLAY_H + PAGE_NUMBER_BAND + columnGap);
  });

  test('1列3ページは1〜3を並べつつ先頭の穴埋め余白も出す', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 5,
      ids: sequentialIds('pg'),
    });
    const { frames } = buildStripFrames(doc.workspaceOrder, { pagesPerColumn: 3 });
    const pageFrames = frames.filter((f) => f.slot.kind === 'page' || f.slot.kind === 'blank');
    const ys = [...new Set(pageFrames.map((f) => f.y))].sort((a, b) => a - b);
    const topSlots = pageFrames
      .filter((f) => f.y === ys[0])
      .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白'));
    expect(topSlots).toEqual([3, 2, 1, '余白']);
    const bottomSlots = pageFrames
      .filter((f) => f.y === ys[1])
      .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白'));
    expect(bottomSlots).toEqual([5, 4]);
    expect(pageFrames.filter((f) => f.slot.kind === 'blank')).toHaveLength(1);
    const blank = pageFrames.find((f) => f.slot.kind === 'blank')!;
    const page4 = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 4)!;
    expect(page4.x).toBe(blank.x);
  });

  test('1列3ページで6枚あっても2と3の間に穴埋めを挟まない', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 6,
      ids: sequentialIds('pg'),
    });
    const { frames } = buildStripFrames(doc.workspaceOrder, { pagesPerColumn: 3 });
    const pageFrames = frames.filter((f) => f.slot.kind === 'page' || f.slot.kind === 'blank');
    const ys = [...new Set(pageFrames.map((f) => f.y))].sort((a, b) => a - b);
    expect(
      pageFrames
        .filter((f) => f.y === ys[0])
        .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白')),
    ).toEqual([3, 2, 1, '余白']);
    expect(
      pageFrames
        .filter((f) => f.y === ys[1])
        .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白')),
    ).toEqual([6, 5, 4]);
    const page6 = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 6)!;
    const page5 = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 5)!;
    const page3 = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 3)!;
    expect(page6.y).toBe(ys[1]);
    expect(page5.y).toBe(ys[1]);
    expect(page3.y).toBe(ys[0]);
    expect(pageFrames.filter((f) => f.slot.kind === 'blank')).toHaveLength(1);
    const blank = pageFrames.find((f) => f.slot.kind === 'blank')!;
    const page4 = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 4)!;
    expect(page4.x).toBe(blank.x);
    expect(page4.y).toBe(ys[1]);
  });

  test('1列3ページは見開き2セットずつ折り返す（9ページ）', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 9,
      ids: sequentialIds('pg'),
    });
    const { frames } = buildStripFrames(doc.workspaceOrder, { pagesPerColumn: 3 });
    const pageFrames = frames.filter((f) => f.slot.kind === 'page' || f.slot.kind === 'blank');
    const ys = [...new Set(pageFrames.map((f) => f.y))].sort((a, b) => a - b);
    expect(ys).toHaveLength(3);
    expect(
      pageFrames
        .filter((f) => f.y === ys[0])
        .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白')),
    ).toEqual([3, 2, 1, '余白']);
    expect(
      pageFrames
        .filter((f) => f.y === ys[1])
        .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白')),
    ).toEqual([7, 6, 5, 4]);
    expect(
      pageFrames
        .filter((f) => f.y === ys[2])
        .map((f) => (f.slot.kind === 'page' ? f.slot.number : '余白')),
    ).toEqual([9, 8]);
    const blank = pageFrames.find((f) => f.slot.kind === 'blank')!;
    const page4 = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 4)!;
    const page8 = pageFrames.find((f) => f.slot.kind === 'page' && f.slot.number === 8)!;
    expect(page4.x).toBe(blank.x);
    expect(page8.x).toBe(blank.x);
  });

  test('余白スライダーは見開きと見開きの間だけに効く', () => {
    const doc = createDocument({
      projectId: 'p',
      name: 't',
      pageCount: 9,
      ids: sequentialIds('pg'),
    });
    const pairGap = 40;
    const { frames } = buildStripFrames(doc.workspaceOrder, {
      pagesPerColumn: 3,
      pairGap,
    });
    const top = frames
      .filter((f) => f.y === 0 && f.slot.kind !== 'append')
      .sort((a, b) => a.x - b.x);
    const label = (f: (typeof top)[number]) =>
      f.slot.kind === 'page' ? f.slot.number : '余白';
    expect(top.map(label)).toEqual([3, 2, 1, '余白']);
    const gap = (a: (typeof top)[number], b: (typeof top)[number]) =>
      b.x - (a.x + PAGE_DISPLAY_W);
    expect(gap(top[0]!, top[1]!)).toBe(SPREAD_INNER_GAP);
    expect(gap(top[1]!, top[2]!)).toBe(pairGap);
    expect(gap(top[2]!, top[3]!)).toBe(SPREAD_INNER_GAP);
    const ys = [...new Set(frames.filter((f) => f.slot.kind === 'page').map((f) => f.y))].sort(
      (a, b) => a - b,
    );
    const second = frames
      .filter((f) => f.y === ys[1] && f.slot.kind !== 'append')
      .sort((a, b) => a.x - b.x);
    expect(second.map(label)).toEqual([7, 6, 5, 4]);
    expect(gap(second[0]!, second[1]!)).toBe(SPREAD_INNER_GAP);
    expect(gap(second[1]!, second[2]!)).toBe(pairGap);
    expect(gap(second[2]!, second[3]!)).toBe(SPREAD_INNER_GAP);
  });
});
