import type { WorkspaceEffect } from '@/src/web/gestures';
import type { PageId } from '@/src/domain/types';

export type WorkspaceGrab = {
  pageId?: PageId;
  fromIndex?: number;
  clipId?: string;
  textId?: string;
  clipIds?: string[];
  textIds?: string[];
};

function endsClipTextGrab(type: WorkspaceEffect['type']): boolean {
  return (
    type === 'commitClipTransform' ||
    type === 'cancelClipTransform' ||
    type === 'commitTextTransform' ||
    type === 'cancelTextTransform' ||
    type === 'commitSelectionMove' ||
    type === 'cancelSelectionMove'
  );
}

/** Apply workspace gesture effects to the stock/cross-pane grab flag. */
export function reduceWorkspaceGrab(
  prev: WorkspaceGrab | null,
  effects: readonly WorkspaceEffect[],
): WorkspaceGrab | null {
  const skipLiveGrab = effects.some((effect) => endsClipTextGrab(effect.type));
  let next = prev;

  for (const effect of effects) {
    if (effect.type === 'grabPage') {
      next = { pageId: effect.pageId, fromIndex: effect.fromIndex };
      continue;
    }
    if (effect.type === 'endGrabPage') {
      next = null;
      continue;
    }
    if (effect.type === 'beginSelectionMove') {
      if (!skipLiveGrab) {
        next = {
          clipId: effect.clipIds[0],
          textId: effect.textIds[0],
          clipIds: effect.clipIds,
          textIds: effect.textIds,
        };
      }
      continue;
    }
    if (effect.type === 'clipTransformLive' && (effect.x !== undefined || effect.y !== undefined)) {
      if (!skipLiveGrab) {
        next =
          next?.clipIds?.length || next?.textIds?.length
            ? next
            : next?.clipId === effect.clipId
              ? next
              : { clipId: effect.clipId };
      }
      continue;
    }
    if (effect.type === 'textTransformLive') {
      if (!skipLiveGrab) {
        next =
          next?.clipIds?.length || next?.textIds?.length
            ? next
            : next?.textId === effect.textId
              ? next
              : { textId: effect.textId };
      }
      continue;
    }
    if (endsClipTextGrab(effect.type) && !next?.pageId) {
      next = null;
    }
  }

  return next;
}

/** Ignore hover/click pointerup after a leftover grab; require the pressed drag pointer. */
export function shouldAcceptCrossPanePointerEnd(input: {
  hasWorkspaceGrab: boolean;
  stockDragging: boolean;
  trackedPointerId: number | null;
  eventPointerId: number;
}): boolean {
  if (input.stockDragging) {
    return input.trackedPointerId == null || input.trackedPointerId === input.eventPointerId;
  }
  if (!input.hasWorkspaceGrab) {
    return false;
  }
  return input.trackedPointerId === input.eventPointerId;
}

export function isCrossPaneDragMove(event: Pick<PointerEvent, 'buttons'>): boolean {
  return event.buttons !== 0;
}
