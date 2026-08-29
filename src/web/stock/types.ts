import type { PageId } from '@/src/domain/types';

export type StockHit =
  | { kind: 'thumb'; pageId: PageId }
  | { kind: 'empty' };

export type StockEffect =
  | { type: 'panBy'; dx: number; dy: number }
  | { type: 'pinchBy'; scaleBy: number; midDx: number; midDy: number }
  | { type: 'dragPage'; pageId: PageId }
  | { type: 'showPageDelete'; pageId: PageId };

export type StockSession =
  | { mode: 'idle' }
  | {
      mode: 'fingerPending';
      kind: 'finger';
      hit: StockHit;
      startX: number;
      startY: number;
      startedAt: number;
    }
  | { mode: 'pan'; kind: 'finger'; lastX: number; lastY: number }
  | {
      mode: 'pinch';
      kind: 'finger';
      pointerId: number;
      partnerId: number;
      lastDist: number;
    }
  | { mode: 'dragPage'; kind: 'finger'; pageId: PageId };

export type StockGestureStore = {
  sessions: Map<number, StockSession>;
  fingerPositions: Map<number, { x: number; y: number }>;
};

export function createStockGestureStore(): StockGestureStore {
  return { sessions: new Map(), fingerPositions: new Map() };
}