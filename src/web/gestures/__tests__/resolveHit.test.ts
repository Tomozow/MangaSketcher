import { describe, expect, test, vi } from 'vitest';

import { buildStripFrames } from '../../../domain/stripGeometry';
import { resolveWorkspaceDropTarget, resolveWorkspaceHit } from '../resolveHit';

describe('resolveWorkspaceHit ink tool priority', () => {
  test('pen and eraser prefer page under a pasteboard clip; select hits the clip', () => {
    vi.stubGlobal('document', {
      elementFromPoint: () => null,
    });

    const workspaceOrder = ['p1'];
    const { frames } = buildStripFrames(workspaceOrder);
    const pageFrame = frames.find((f) => f.slot.kind === 'page')!;
    const worldX = pageFrame.x + pageFrame.width / 2;
    const worldY = pageFrame.y + pageFrame.height / 2;

    const surfaceEl = {
      getBoundingClientRect: () =>
        ({
          left: 0,
          top: 0,
          width: 2000,
          height: 3000,
          right: 2000,
          bottom: 3000,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
      contains: () => true,
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;

    const shared = {
      clientX: worldX,
      clientY: worldY,
      surfaceEl,
      workspaceOrder,
      pages: { p1: { texts: [] } },
      pasteboardClips: [
        {
          id: 'clip1',
          x: worldX,
          y: worldY,
          scale: 1,
          rotation: 0,
          rasterId: 'r1',
        },
      ],
      pasteboardTexts: [],
      selectedClipId: null,
      panX: 0,
      panY: 0,
      zoom: 1,
      rasterWidth: 1200,
      rasterHeight: 1700,
      getClipRasterSize: () => ({ width: 400, height: 300 }),
    };

    expect(resolveWorkspaceHit({ ...shared, tool: 'select' }).kind).toBe('clip');
    expect(resolveWorkspaceHit({ ...shared, tool: 'pen' }).kind).toBe('page');
    expect(resolveWorkspaceHit({ ...shared, tool: 'eraser' }).kind).toBe('page');
    expect(resolveWorkspaceHit({ ...shared, tool: 'eraser', selectedClipId: 'clip1' }).kind).toBe(
      'page',
    );
    expect(resolveWorkspaceHit({ ...shared, tool: 'select', selectedClipId: 'clip1' }).kind).toBe(
      'clip',
    );
    expect(
      resolveWorkspaceHit({
        ...shared,
        tool: 'select',
        selectTargets: { text: true, ink: true, clip: false },
      }).kind,
    ).toBe('page');

    vi.unstubAllGlobals();
  });

  test('text tool falls back to world geometry when DOM page rects miss', () => {
    vi.stubGlobal('document', {
      elementFromPoint: () => null,
    });

    const workspaceOrder = ['p1'];
    const { frames } = buildStripFrames(workspaceOrder);
    const pageFrame = frames.find((f) => f.slot.kind === 'page')!;
    const worldX = pageFrame.x + 40;
    const worldY = pageFrame.y + 80;

    const surfaceEl = {
      getBoundingClientRect: () =>
        ({
          left: 0,
          top: 0,
          width: 2000,
          height: 3000,
          right: 2000,
          bottom: 3000,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
      contains: () => true,
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;

    const hit = resolveWorkspaceHit({
      clientX: worldX,
      clientY: worldY,
      surfaceEl,
      workspaceOrder,
      pages: {
        p1: {
          texts: [
            {
              id: 'tx1',
              content: 'あ',
              color: '#000',
              fontSize: 18,
              box: { x: 0, y: 0, width: 400, height: 600 },
            },
          ],
        },
      },
      pasteboardClips: [],
      pasteboardTexts: [],
      selectedClipId: null,
      panX: 0,
      panY: 0,
      zoom: 1,
      rasterWidth: 1200,
      rasterHeight: 1700,
      getClipRasterSize: () => ({ width: 400, height: 300 }),
      tool: 'text',
    });

    expect(hit.kind).toBe('pageText');
    if (hit.kind === 'pageText') {
      expect(hit.textId).toBe('tx1');
    }

    vi.unstubAllGlobals();
  });

  test('topmost pasteboard text wins, selected text handle wins over body, and drop ignores both', () => {
    vi.stubGlobal('document', { elementFromPoint: () => null });
    const workspaceOrder = ['p1'];
    const { frames } = buildStripFrames(workspaceOrder);
    const frame = frames.find((item) => item.slot.kind === 'page')!;
    const worldBox = {
      x: frame.x,
      y: frame.y,
      width: frame.width * 0.1,
      height: frame.height * 0.1,
    };
    const surfaceEl = {
      getBoundingClientRect: () =>
        ({ left: 10, top: 20, width: 2000, height: 3000, right: 2010, bottom: 3020 }) as DOMRect,
      contains: () => true,
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    const panX = 30;
    const panY = 40;
    const zoom = 2;
    const shared = {
      clientX: 10 + panX + (worldBox.x + 5) * zoom,
      clientY: 20 + panY + (worldBox.y + 5) * zoom,
      surfaceEl,
      workspaceOrder,
      pages: {
        p1: {
          texts: [
            {
              id: 'page-text',
              content: 'page',
              color: '#000',
              fontSize: 18,
              box: { x: 0, y: 0, width: 120, height: 170 },
            },
          ],
        },
      },
      pasteboardClips: [],
      pasteboardTexts: [
        { id: 'pb-text', content: 'pb', color: '#000', fontSize: 18, box: worldBox },
      ],
      selectedClipId: null,
      panX,
      panY,
      zoom,
      rasterWidth: 1200,
      rasterHeight: 1700,
      getClipRasterSize: () => ({ width: 1, height: 1 }),
      tool: 'text' as const,
    };

    expect(resolveWorkspaceHit(shared)).toMatchObject({ kind: 'pasteboardText', textId: 'pb-text' });

    const handleInput = {
      ...shared,
      selectedTextId: 'page-text',
      clientX: 10 + panX + (worldBox.x + worldBox.width) * zoom,
      clientY: 20 + panY + (worldBox.y + worldBox.height) * zoom,
    };
    expect(resolveWorkspaceHit(handleInput)).toMatchObject({
      kind: 'resizeHandle',
      textId: 'page-text',
      owner: 'page',
      pageId: 'p1',
    });
    expect(resolveWorkspaceDropTarget(handleInput)).toMatchObject({ kind: 'page', pageId: 'p1' });
    vi.unstubAllGlobals();
  });
});
