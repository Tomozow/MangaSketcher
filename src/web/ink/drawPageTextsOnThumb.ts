import {
  isTextContentEmpty,
  shouldRotateForVerticalRl,
  verticalGlyphs,
  verticalRlCanvasGlyph,
} from '../../domain/text';
import type { PageText, Rect } from '../../domain/types';
import { writingModeOf } from '../../domain/types';
import { expandTextBoxWidthToColumns, verticalColumnPitch } from '../../domain/textWrap';
import { pageTextCanvasFont } from '../pageTextFont';
import {
  isWhiteTextColor,
  WHITE_TEXT_CANVAS_STROKE_RATIO,
  WHITE_TEXT_STROKE_COLOR,
} from '../text/whiteTextColor';

export type ThumbText = Pick<PageText, 'content' | 'box' | 'fontSize' | 'color' | 'writingMode'>;

type ThumbTextContext = {
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillText(text: string, x: number, y: number): void;
  strokeText?(text: string, x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  font: string;
  fillStyle: string;
  strokeStyle?: string;
  lineWidth?: number;
  lineJoin?: CanvasLineJoin;
  miterLimit?: number;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
};

function destRect(box: Rect, scaleX: number, scaleY: number): Rect {
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
}

/**
 * Paint page texts onto a thumbnail canvas (overflow clipped).
 * Matches workspace wrap: fontSize is raster-local, scaled by dest/raster width.
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
    const fontSize = Number.isFinite(text.fontSize) ? text.fontSize : 12;
    const mode = writingModeOf(text.writingMode);
    const layoutBox = expandTextBoxWidthToColumns(text.box, text.content, fontSize, mode);
    const box = destRect(layoutBox, scaleX, scaleY);
    const fontPx = Math.max(1, fontSize * scaleX);
    const pitch = verticalColumnPitch(fontPx);
    if (box.width <= 0 || box.height <= 0) {
      continue;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    ctx.fillStyle = text.color || '#1A1A1A';
    ctx.font = pageTextCanvasFont(fontPx);
    ctx.textBaseline = 'top';
    const outline = isWhiteTextColor(text.color) && typeof ctx.strokeText === 'function';
    if (outline) {
      ctx.strokeStyle = WHITE_TEXT_STROKE_COLOR;
      ctx.lineWidth = Math.max(1, fontPx * WHITE_TEXT_CANVAS_STROKE_RATIO);
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
    }

    if (mode === 'horizontal') {
      ctx.textAlign = 'left';
      let x = box.x;
      let y = box.y;
      for (const glyph of verticalGlyphs(text.content)) {
        if (glyph === '\r') {
          continue;
        }
        const wrap = glyph === '\n' || x + fontPx > box.x + box.width + 0.01;
        if (wrap) {
          y += pitch;
          x = box.x;
          if (glyph === '\n') {
            continue;
          }
        }
        if (y + fontPx > box.y + box.height + 0.01) {
          break;
        }
        if (outline) {
          ctx.strokeText!(glyph, x, y);
        }
        ctx.fillText(glyph, x, y);
        x += fontPx;
      }
    } else {
      ctx.textAlign = 'center';
      let colX = box.x + box.width - pitch;
      let y = box.y;
      for (const glyph of verticalGlyphs(text.content)) {
        if (glyph === '\r') {
          continue;
        }
        const wrap = glyph === '\n' || y + fontPx > box.y + box.height + 0.01;
        if (wrap) {
          colX -= pitch;
          y = box.y;
          if (glyph === '\n') {
            continue;
          }
        }
        if (colX + pitch < box.x) {
          break;
        }
        const gx = colX + pitch / 2;
        paintVerticalGlyph(ctx, glyph, gx, y, fontPx, outline);
        y += fontPx;
      }
    }
    ctx.restore();
  }
}

function paintVerticalGlyph(
  ctx: ThumbTextContext,
  glyph: string,
  gx: number,
  y: number,
  fontPx: number,
  outline: boolean,
): void {
  const drawn = verticalRlCanvasGlyph(glyph);
  if (shouldRotateForVerticalRl(glyph)) {
    ctx.save();
    ctx.translate(gx, y + fontPx / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.strokeText!(drawn, 0, 0);
    }
    ctx.fillText(drawn, 0, 0);
    ctx.restore();
    return;
  }
  if (outline) {
    ctx.strokeText!(drawn, gx, y);
  }
  ctx.fillText(drawn, gx, y);
}
