export const STOCK_EDGE_REVEAL_PX = 80;
export const STOCK_EDGE_REVEAL_HOLD_MS = 500;

export type StockRevealEdge = 'top' | 'bottom';

export function shouldRevealStockAtDockEdge(
  clientY: number,
  viewportHeight: number,
  edge: StockRevealEdge,
  zonePx: number = STOCK_EDGE_REVEAL_PX,
): boolean {
  if (edge === 'top') {
    return clientY <= zonePx;
  }
  return clientY >= viewportHeight - zonePx;
}

export function shouldRevealStockAtBottomEdge(
  clientY: number,
  viewportHeight: number,
  zonePx: number = STOCK_EDGE_REVEAL_PX,
): boolean {
  return shouldRevealStockAtDockEdge(clientY, viewportHeight, 'bottom', zonePx);
}
