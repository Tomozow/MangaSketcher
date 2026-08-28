import type { StrokePoint } from '../../domain/stroke';

export type BrushStrokeStyle = {
  color: string;
  lineWidth: number;
  globalAlpha: number;
  composite: GlobalCompositeOperation;
};

type StrokeContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'fillStyle'
  | 'strokeStyle'
  | 'globalAlpha'
  | 'globalCompositeOperation'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
>;

export function drawBrushStroke(ctx: StrokeContext, points: StrokePoint[], style: BrushStrokeStyle): void {
  if (points.length === 0) {
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = style.composite;
  ctx.globalAlpha = style.globalAlpha;
  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, style.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i]!.x, points[i]!.y);
    }
    ctx.stroke();
  }

  ctx.restore();
}
