'use client';

import { useSyncExternalStore } from 'react';
import type { TextId } from '@/src/domain/types';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

export type LiveTextContent = {
  id: TextId;
  content: string;
};

let live: LiveTextContent | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): LiveTextContent | null {
  return live;
}

/** Live IME draft. External store so typing does not re-render the 34-page strip + PDF. */
export function setLiveTextContent(next: LiveTextContent | null): void {
  if (live === next) {
    return;
  }
  if (
    live &&
    next &&
    live.id === next.id &&
    live.content === next.content
  ) {
    return;
  }
  // #region agent log
  ipadDebugLog({
    sessionId: '2ca20f',
    ingest: 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426',
    hypothesisId: 'C',
    location: 'liveTextContentStore.ts:setLiveTextContent',
    message: 'live store emit',
    data: {
      nextLen: next?.content.length ?? -1,
      prevLen: live?.content.length ?? -1,
      sameId: live?.id === next?.id,
    },
  });
  // #endregion
  live = next;
  emit();
}

export function useLiveTextContent(): LiveTextContent | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
