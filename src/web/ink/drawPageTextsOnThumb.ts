import { isTextContentEmpty, verticalGlyphs } from '../../domain/text';
import type { PageText, Rect } from '../../domain/types';
import { pageTextCanvasFont } from '../pageTextFont';

export type ThumbText = Pick<PageText, 'content' | 'box' | 'fontSize' | 'color'>;

type ThumbTextContext = {
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillText(text: string, x: number, y: number): void;
  font: string;
  fillStyle: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
};

const LINE_HEIGHT = 1.2;

function destRect(box: Rect, scaleX: number, scaleY: number): Rect {
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

/**
 * Paint page texts onto a thumbnail canvas (vertical-rl, overflow clipped).
 * Matches workspace DOM: fontSize is raster-local, scaled by dest/raster width.
 */
export function drawPageTextsOnThumb(
  ctx: ThumbTextContext,
  texts: readonly ThumbText[],
  rasterWidth: number,
  rasterHeight: number,
  destWidth: number,
  destHeight: number,
): void {
  const rw = rasterWidth > 0 ? rasterWidth : destWidth;
  const rh = rasterHeight > 0 ? rasterHeight : destHeight;
  const scaleX = destWidth / rw;
  const scaleY = destHeight / rh;

  for (const text of texts) {
    if (isTextContentEmpty(text.content)) {
      continue;
    }
    const box = destRect(text.box, scaleX, scaleY);
    const fontPx = Math.max(1, (Number.isFinite(text.fontSize) ? text.fontSize : 12) * scaleX);
    const colW = fontPx * LINE_HEIGHT;
    if (box.width <= 0 || box.height <= 0) {
      continue;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    ctx.fillStyle = text.color || '#1A1A1A';
    ctx.font = pageTextCanvasFont(fontPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    let colX = box.x + box.width - colW;
    let y = box.y;
    for (const glyph of verticalGlyphs(text.content)) {
      if (glyph === '\r') {
        continue;
      }
      const wrap = glyph === '\n' || y + fontPx > box.y + box.height + 0.01;
      if (wrap) {
        colX -= colW;
        y = box.y;
        if (glyph === '\n') {
          continue;
        }
      }
      if (colX + colW < box.x) {
        break;
      }
      ctx.fillText(glyph, colX + colW / 2, y);
      y += fontPx;
    }
    ctx.restore();
  }
}
