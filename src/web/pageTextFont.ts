/** Bundled 源暎アンチック v6 Medium (`public/fonts/GenEiAntiqueNv6-M.ttf`). */
export const PAGE_TEXT_FONT_FAMILY = 'GenEiAntique';
export const PAGE_TEXT_FONT_STACK = `"${PAGE_TEXT_FONT_FAMILY}", "源暎アンチック v6", "GenEi Antique v6", sans-serif`;

export function pageTextCanvasFont(px: number): string {
  return `${px}px ${PAGE_TEXT_FONT_STACK}`;
}
