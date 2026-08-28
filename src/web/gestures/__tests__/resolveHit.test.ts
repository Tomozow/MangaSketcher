import { describe, expect, test, vi } from 'vitest';

import { buildStripFrames } from '../../../domain/stripGeometry';
import { resolveWorkspaceHit } from '../resolveHit';

describe('resolveWorkspaceHit ink tool priority', () => {
  test('pen and eraser prefer page under a pasteboard clip', () => {
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

    vi.unstubAllGlobals();
  });
});
