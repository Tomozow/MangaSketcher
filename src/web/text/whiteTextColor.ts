/** Palette white and near-white fills that need a black outline. */
const WHITE_LUMA_MIN = 245;

export const WHITE_TEXT_STROKE_COLOR = '#000000';
/** CSS `-webkit-text-stroke` width as a fraction of `em`. */
export const WHITE_TEXT_STROKE_EM = 0.08;
/** Canvas stroke is centered; ~2× the CSS em so the outside halo matches. */
export const WHITE_TEXT_CANVAS_STROKE_RATIO = 0.16;

export function isWhiteTextColor(color: string | undefined): boolean {
  if (!color) {
    return false;
  }
  const trimmed = color.trim().toLowerCase();
  if (trimmed === 'white' || trimmed === '#fff' || trimmed === '#ffffff' || trimmed === '#ffffffff') {
    return true;
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(trimmed);
  if (hex) {
    const body = hex[1]!;
    const r = body.length === 3 ? parseInt(body[0]! + body[0]!, 16) : parseInt(body.slice(0, 2), 16);
    const g = body.length === 3 ? parseInt(body[1]! + body[1]!, 16) : parseInt(body.slice(2, 4), 16);
    const b = body.length === 3 ? parseInt(body[2]! + body[2]!, 16) : parseInt(body.slice(4, 6), 16);
    return r >= WHITE_LUMA_MIN && g >= WHITE_LUMA_MIN && b >= WHITE_LUMA_MIN;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/.exec(trimmed);
  if (rgb) {
    return (
      Number(rgb[1]) >= WHITE_LUMA_MIN &&
      Number(rgb[2]) >= WHITE_LUMA_MIN &&
      Number(rgb[3]) >= WHITE_LUMA_MIN
    );
  }
  return false;
}
