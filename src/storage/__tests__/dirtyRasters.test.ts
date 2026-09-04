import { describe, expect, test } from 'vitest';

import { createEditorDocument, sequentialIds } from '../../domain/document';
import { reduceEditorDocument } from '../../domain/editorReducer';
import { dirtyRasterIdsForAction } from '../dirtyRasters';

describe('dirtyRasterIdsForAction', () => {
  test('commitMarqueeCut marks the page and new clip only', () => {
    const ids = sequentialIds('id');
    const prev = createEditorDocument({
      projectId: 'p1',
      name: 'n',
      pageCount: 2,
      ids: sequentialIds('page'),
    });
    const pageId = prev.workspaceOrder[0]!;
    const extraClip = 'p1:clip:old';
    prev.pasteboardClips.push({
      id: 'old',
      rasterId: extraClip,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    const action = {
      type: 'commitMarqueeCut' as const,
      pageId,
      clipId: 'c-new',
      rasterId: 'p1:clip:c-new',
      workspaceX: 1,
      workspaceY: 2,
    };
    const next = reduceEditorDocument(prev, action, ids);
    const dirty = dirtyRasterIdsForAction(prev, next, action);
    expect(dirty).toEqual([prev.pages[pageId]!.rasterId, 'p1:clip:c-new']);
    expect(dirty).not.toContain(extraClip);
    expect(dirty).not.toContain(prev.pages[prev.workspaceOrder[1]!]!.rasterId);
  });

  test('transformClip does not dirty rasters', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const pageId = doc.workspaceOrder[0]!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'commitMarqueeCut',
        pageId,
        clipId: 'c1',
        rasterId: 'p1:clip:c1',
        workspaceX: 0,
        workspaceY: 0,
      },
      ids,
    );
    const prev = doc;
    const action = { type: 'transformClip' as const, clipId: 'c1', x: 8, y: 9 };
    const next = reduceEditorDocument(prev, action, ids);
    expect(dirtyRasterIdsForAction(prev, next, action)).toEqual([]);
  });

  test('commitClipScissorsCut marks the source and new clip', () => {
    const ids = sequentialIds('id');
    let doc = createEditorDocument({
      projectId: 'p1',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('page'),
    });
    const pageId = doc.workspaceOrder[0]!;
    doc = reduceEditorDocument(
      doc,
      {
        type: 'commitMarqueeCut',
        pageId,
        clipId: 'c1',
        rasterId: 'p1:clip:c1',
        workspaceX: 0,
        workspaceY: 0,
      },
      ids,
    );
    const prev = doc;
    const action = {
      type: 'commitClipScissorsCut' as const,
      sourceClipId: 'c1',
      sourceEmpty: false,
      sourceX: 2,
      sourceY: 3,
      piece: {
        clipId: 'c2',
        rasterId: 'p1:clip:c2',
        x: 4,
        y: 5,
        scale: 1,
        rotation: 0,
      },
    };
    const next = reduceEditorDocument(prev, action, ids);
    expect(dirtyRasterIdsForAction(prev, next, action)).toEqual(['p1:clip:c1', 'p1:clip:c2']);
  });
});
