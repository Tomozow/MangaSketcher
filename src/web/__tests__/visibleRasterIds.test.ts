import { describe, expect, test } from 'vitest';
import { createEditorDocument } from '@/src/storage/editorDocument';
import { visiblePageRasterIds } from '@/src/web/visibleRasterIds';

describe('visiblePageRasterIds', () => {
  test('pins workspace pages and visible clips, not stock or trash', () => {
    const doc = createEditorDocument({ projectId: 'p1', name: 'n', pageCount: 3 });
    const [a, b, c] = doc.workspaceOrder;
    doc.workspaceOrder = [a!];
    doc.stock = [{ pageId: b!, x: 0, y: 0 }];
    doc.trash = [c!];
    doc.pasteboardClips = [
      { id: 'c1', rasterId: 'p1:clip:c1', x: 0, y: 0, scale: 1, rotation: 0 },
      { id: 'c2', rasterId: 'p1:clip:c2', x: 0, y: 0, scale: 1, rotation: 0 },
      { id: 'c3', rasterId: 'p1:clip:c3', x: 0, y: 0, scale: 1, rotation: 0 },
    ];
    doc.stock.push({ kind: 'clip', clipId: 'c2', x: 0, y: 0 });
    doc.trashClips = ['c3'];

    const ids = visiblePageRasterIds(doc);
    expect(ids).toEqual([doc.pages[a!]!.rasterId, 'p1:clip:c1']);
    expect(ids).not.toContain(doc.pages[b!]!.rasterId);
    expect(ids).not.toContain(doc.pages[c!]!.rasterId);
    expect(ids).not.toContain('p1:clip:c2');
    expect(ids).not.toContain('p1:clip:c3');
  });
});
