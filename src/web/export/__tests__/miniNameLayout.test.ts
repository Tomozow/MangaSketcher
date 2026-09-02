import { describe, expect, test } from 'vitest';
import { createEditorDocument, sequentialIds } from '../../../domain/document';
import { PAGE_DISPLAY_H, PAGE_NUMBER_BAND } from '../../../domain/stripGeometry';
import {
  buildMiniNameFileName,
  formatMiniNameCoverDateTime,
  miniNameSheetLayout,
  wrapCoverText,
} from '../miniNameLayout';

describe('miniNameSheetLayout', () => {
  test('one row lays out RTL manga: blank is to the right of page 1', () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 5,
      ids: sequentialIds('pg'),
    });
    doc.pagesPerColumn = 0;
    const layout = miniNameSheetLayout(doc);
    const pageTiles = layout.tiles.filter((tile) => tile.kind === 'page');
    const coverTiles = layout.tiles.filter((tile) => tile.kind === 'cover');
    expect(pageTiles.map((tile) => tile.workspaceNumber)).toEqual([5, 4, 3, 2, 1]);
    expect(coverTiles).toHaveLength(1);
    const page1 = pageTiles.find((tile) => tile.workspaceNumber === 1)!;
    expect(page1.x + page1.width).toBeCloseTo(coverTiles[0]!.x);
    expect(layout.width).toBeGreaterThan(1);
    expect(layout.height).toBeGreaterThan(1);
  });

  test('ignores workspace columnGap between rows', () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 7,
      ids: sequentialIds('pg'),
    });
    doc.pagesPerColumn = 3;
    doc.columnGap = PAGE_DISPLAY_H;
    const layout = miniNameSheetLayout(doc);
    const ys = [...new Set(layout.tiles.map((tile) => Math.round(tile.y * 1000) / 1000))].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThanOrEqual(2);
    expect(ys[1]! - ys[0]!).toBeCloseTo((PAGE_DISPLAY_H + PAGE_NUMBER_BAND) * layout.pixelScale);
  });

  test('file name is stem_timestamp_mininame.jpg', () => {
    expect(buildMiniNameFileName('題', '20260901-1400')).toBe('題_20260901-1400_mininame.jpg');
  });

  test('cover datetime is local Japanese date and time', () => {
    expect(formatMiniNameCoverDateTime(new Date(2026, 8, 1, 14, 0, 0))).toBe('2026年9月1日 14:00');
  });

  test('wrapCoverText breaks when the next character would overflow', () => {
    expect(wrapCoverText('あいうえ', 20, (line) => line.length * 10)).toEqual(['あい', 'うえ']);
  });
});
