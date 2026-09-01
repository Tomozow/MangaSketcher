/** Newest stock items sit on the left (back). Reveal that thumb in the grid scroller. */
export function scrollStockGridToBack(surface: HTMLElement, itemKey: string): void {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(itemKey) : itemKey;
  const thumb = surface.querySelector(`[data-stock-item-key="${escaped}"]`);
  if (thumb && typeof (thumb as HTMLElement).scrollIntoView === 'function') {
    (thumb as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'start' });
    return;
  }
  surface.scrollLeft = 0;
}

/** Pack the grid to the right edge (`justify-content: end`) and reset vertical scroll. */
export function snapStockGridToPackedEnd(surface: HTMLElement): void {
  surface.scrollTop = 0;
  surface.scrollLeft = Math.max(0, surface.scrollWidth - surface.clientWidth);
}
