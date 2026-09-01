export const STOCK_EDGE_REVEAL_PX = 80;
export const STOCK_EDGE_REVEAL_HOLD_MS = 500;

export function shouldRevealStockAtBottomEdge(
  clientY: number,
  viewportHeight: number,
  zonePx: number = STOCK_EDGE_REVEAL_PX,
): boolean {
  return clientY >= viewportHeight - zonePx;
}
