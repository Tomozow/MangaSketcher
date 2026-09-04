import { describe, expect, test } from 'vitest';
import {
  buildTextInteractionElements,
  hitTextInteraction,
  pageBoxToWorld,
  textBoxForOwnerMove,
  textPoseAfterWorldMove,
  worldBoxToPage,
} from '../elementInteraction';
import { buildStripFrames, PAGE_DISPLAY_W } from '../../../domain/stripGeometry';

describe('workspace element interaction geometry', () => {
  test('page-local boxes round-trip through world space', () => {
    const { frames } = buildStripFrames(['p1']);
    const frame = frames.find((item) => item.slot.kind === 'page')!;
    const source = { x: 120, y: 340, width: 240, height: 510 };
    const world = pageBoxToWorld(frame, source, 1200, 1700);
    const roundTrip = worldBoxToPage(frame, world, 1200, 1700);
    expect(roundTrip.x).toBeCloseTo(source.x);
    expect(roundTrip.y).toBeCloseTo(source.y);
    expect(roundTrip.width).toBeCloseTo(source.width);
    expect(roundTrip.height).toBeCloseTo(source.height);
    expect(
      textBoxForOwnerMove({
        sourceWhere: 'page',
        sourcePageId: 'p1',
        sourceBox: { x: 0, y: 0, width: 1200, height: 1700 },
        x: 40,
        y: 50,
        targetPasteboard: true,
        frameForPageId: (pageId) =>
          pageId === 'p1' ? { x: 0, y: 0, width: frame.width, height: frame.height } : null,
        rasterWidth: 1200,
        rasterHeight: 1700,
      }),
    ).toMatchObject({
      x: 40,
      y: 50,
      width: frame.width,
      height: frame.height,
    });
    const onPage = pageBoxToWorld(frame, { x: 120, y: 340, width: 96, height: 425 }, 1200, 1700);
    expect(
      textBoxForOwnerMove({
        sourceWhere: 'page',
        sourcePageId: 'p1',
        sourceBox: { x: 120, y: 340, width: 96, height: 425 },
        x: 10,
        y: 20,
        targetPasteboard: true,
        frameForPageId: () => frame,
        rasterWidth: 1200,
        rasterHeight: 1700,
      }).width,
    ).toBeCloseTo(onPage.width);
  });

  test('pasteboard text is topmost over overlapping page text', () => {
    const elements = buildTextInteractionElements({
      workspaceOrder: ['p1'],
      pages: {
        p1: {
          texts: [
            {
              id: 'page',
              content: 'あいうえお',
              color: '#000',
              fontSize: 20,
              box: { x: 0, y: 0, width: 120, height: 170 },
            },
          ],
        },
      },
      pasteboardTexts: [
        {
          id: 'pasteboard',
          content: 'あいうえお',
          color: '#000',
          fontSize: 20,
          box: { x: 0, y: 0, width: 500, height: 500 },
        },
      ],
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    const page = elements.find((element) => element.id === 'page')!;

    expect(hitTextInteraction(elements, page.worldBox.x + 2, page.worldBox.y + 2, null, 8))
      .toMatchObject({ element: { id: 'pasteboard' }, handle: 'body' });
    expect(
      hitTextInteraction(
        elements,
        page.worldBox.x + page.worldBox.width,
        page.worldBox.y + page.worldBox.height,
        'page',
        8,
      ),
    ).toMatchObject({ element: { id: 'pasteboard' }, handle: 'body' });
  });

  test('geometry hit ignores leftover balloon height below glyphs', () => {
    const elements = buildTextInteractionElements({
      workspaceOrder: ['p1'],
      pages: {
        p1: {
          texts: [
            {
              id: 'short',
              content: 'あ',
              color: '#000',
              fontSize: 25,
              box: { x: 0, y: 0, width: 38, height: 300 },
            },
          ],
        },
      },
      pasteboardTexts: [],
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    const short = elements.find((element) => element.id === 'short')!;
    expect(short.sourceBox.height).toBe(25);
    expect(
      hitTextInteraction(elements, short.worldBox.x + 1, short.worldBox.y + short.worldBox.height + 20, null, 0),
    ).toBeNull();
  });

  test('world origin chooses page vs pasteboard and converts box size', () => {
    const { frames } = buildStripFrames(['p1', 'p2']);
    const page1 = frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === 'p1')!;
    const page2 = frames.find((item) => item.slot.kind === 'page' && item.slot.pageId === 'p2')!;
    const sourceBox = { x: 120, y: 340, width: 96, height: 425 };
    const world = pageBoxToWorld(page1, sourceBox, 1200, 1700);

    const stay = textPoseAfterWorldMove({
      sourceWhere: 'page',
      sourcePageId: 'p1',
      sourceBox,
      sourceFontSize: 24,
      worldX: world.x + 8,
      worldY: world.y,
      frames,
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    expect(stay.attachment).toEqual({ kind: 'page', pageId: 'p1' });
    expect(stay.box.width).toBeCloseTo(sourceBox.width);
    expect(stay.box.x).toBeCloseTo(sourceBox.x + 8 * (1200 / page1.width));
    expect(stay.fontSize).toBeCloseTo(24);

    const offPage = textPoseAfterWorldMove({
      sourceWhere: 'page',
      sourcePageId: 'p1',
      sourceBox,
      sourceFontSize: 24,
      worldX: page1.x + page1.width + 12,
      worldY: world.y,
      frames,
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    expect(offPage.attachment).toEqual({ kind: 'pasteboard' });
    expect(offPage.box.x).toBeCloseTo(page1.x + page1.width + 12);
    expect(offPage.box.width).toBeCloseTo(world.width);
    expect(offPage.fontSize).toBeCloseTo(24);

    const otherPage = textPoseAfterWorldMove({
      sourceWhere: 'page',
      sourcePageId: 'p1',
      sourceBox,
      sourceFontSize: 24,
      worldX: page2.x + 20,
      worldY: page2.y + 30,
      frames,
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    expect(otherPage.attachment).toEqual({ kind: 'page', pageId: 'p2' });
    expect(otherPage.box.x).toBeCloseTo((20 / page2.width) * 1200);
    expect(otherPage.box.y).toBeCloseTo((30 / page2.height) * 1700);
    expect(otherPage.box.width).toBeCloseTo(sourceBox.width);

    const ontoPage = textPoseAfterWorldMove({
      sourceWhere: 'pasteboard',
      sourceBox: { x: 0, y: 0, width: world.width, height: world.height },
      sourceFontSize: 24 * (world.width / sourceBox.width),
      worldX: page1.x + 18,
      worldY: page1.y + 36,
      frames,
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    expect(ontoPage.attachment).toEqual({ kind: 'page', pageId: 'p1' });
    expect(ontoPage.box.width).toBeCloseTo(sourceBox.width);
    expect(ontoPage.box.height).toBeCloseTo(sourceBox.height);

    const columnGap = 60;
    const pairGap = 48;
    const { frames: gapped } = buildStripFrames(['p1', 'p2', 'p3'], { pairGap, columnGap });
    const gapped1 = gapped.find((item) => item.slot.kind === 'page' && item.slot.pageId === 'p1')!;
    const gapped2 = gapped.find((item) => item.slot.kind === 'page' && item.slot.pageId === 'p2')!;
    const above = textPoseAfterWorldMove({
      sourceWhere: 'page',
      sourcePageId: 'p1',
      sourceBox,
      sourceFontSize: 24,
      worldX: gapped1.x + 20,
      worldY: columnGap / 2,
      frames: gapped,
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    expect(above.attachment).toEqual({ kind: 'pasteboard' });
    expect(above.box.y).toBeCloseTo(columnGap / 2);

    const betweenX = Math.min(gapped1.x, gapped2.x) + PAGE_DISPLAY_W + pairGap / 2;
    const between = textPoseAfterWorldMove({
      sourceWhere: 'page',
      sourcePageId: 'p1',
      sourceBox,
      sourceFontSize: 24,
      worldX: betweenX,
      worldY: gapped1.y + 40,
      frames: gapped,
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    expect(between.attachment).toEqual({ kind: 'pasteboard' });
  });

  test('text hit uses the box plus pad, not a 44px minimum', () => {
    const elements: ReturnType<typeof buildTextInteractionElements> = [
      {
        id: 'narrow',
        owner: { kind: 'pasteboard' },
        sourceBox: { x: 100, y: 100, width: 10, height: 40 },
        worldBox: { x: 100, y: 100, width: 10, height: 40 },
        zIndex: 0,
      },
    ];
    expect(hitTextInteraction(elements, 100 - 5, 120, null, 5)).toMatchObject({
      element: { id: 'narrow' },
    });
    expect(hitTextInteraction(elements, 100 - 6, 120, null, 5)).toBeNull();
    expect(hitTextInteraction(elements, 100 + 10 + 5, 120, null, 5)).toMatchObject({
      element: { id: 'narrow' },
    });
    expect(hitTextInteraction(elements, 100 + 10 + 6, 120, null, 5)).toBeNull();
  });

  test('pasteboard grab origin is the stored box, not a raster-font hug to the left', () => {
    const stored = { x: 752.77, y: 743.68, width: 7, height: 14 };
    const elements = buildTextInteractionElements({
      workspaceOrder: ['p1'],
      pages: { p1: { texts: [] } },
      pasteboardTexts: [
        {
          id: 'pb',
          content: 'あ',
          color: '#000',
          fontSize: 25,
          box: stored,
        },
      ],
      rasterWidth: 1200,
      rasterHeight: 1700,
    });
    const pb = elements.find((element) => element.id === 'pb')!;
    expect(pb.sourceBox.x).toBeCloseTo(stored.x);
    expect(pb.worldBox.x).toBeCloseTo(stored.x);
    expect(pb.worldBox.width).toBeCloseTo(stored.width);
  });
});
