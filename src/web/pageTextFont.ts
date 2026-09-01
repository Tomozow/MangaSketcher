/** Iwata Antique Std B (PostScript IwaAntStd-B) when installed; otherwise the next family. */
export const PAGE_TEXT_FONT_STACK =
  '"IwaAntStd-B", "I-OTFアンチックStd B", "I-OTF アンチック Std B", "I-OTF Antique Std B", sans-serif';

export function pageTextCanvasFont(px: number): string {
  return `${px}px ${PAGE_TEXT_FONT_STACK}`;
}
