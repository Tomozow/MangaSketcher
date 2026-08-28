import { describe, expect, test } from 'vitest';
import {
  buildTextInteractionElements,
  hitTextInteraction,
  pageBoxToWorld,
  worldBoxToPage,
} from '../elementInteraction';
import { buildStripFrames } from '../../../domain/stripGeometry';

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
  });

  test('pasteboard text is topmost, but the selected page handle has priority', () => {
    const elements = buildTextInteractionElements({
      workspaceOrder: ['p1'],
      pages: {
        p1: {
          texts: [
            {
              id: 'page',
              content: '',
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
          content: '',
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
    ).toMatchObject({ element: { id: 'page' }, handle: 'se' });
  });
});
