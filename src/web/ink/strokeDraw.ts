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

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0]!.x, points[0]!.y, style.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i]!.x, points[i]!.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Continues a live stroke so fast pointer gaps are filled instead of dotted stamps. */
export function appendLiveBrushStroke(
  ctx: StrokeContext,
  previous: StrokePoint | null,
  next: StrokePoint[],
  styleFor: (point: StrokePoint) => BrushStrokeStyle,
): StrokePoint | null {
  if (next.length === 0) {
    return previous;
  }
  const chain = previous ? [previous, ...next] : next;
  const last = chain[chain.length - 1]!;
  drawBrushStroke(ctx, chain, styleFor(last));
  return last;
}
