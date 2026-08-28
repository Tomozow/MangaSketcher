'use client';

import { useEffect, useRef } from 'react';

import type { InkEngine } from './InkEngine';

type PageInkCanvasProps = {
  engine: InkEngine;
  rasterId: string;
  className?: string;
  /** CSS display width (spec: 216). Height follows raster aspect. */
  displayWidth?: number;
  /** Bumped while drawing so overlay composites repaint. */
  inkFrame?: number;
};

const painters = new Map<string, () => void>();

/** Paint the on-screen copy immediately (do not wait for React). */
export function repaintInkDisplay(rasterId: string): void {
  painters.get(rasterId)?.();
}

/**
 * Display copy (§9.5): scales 1200×1700 hot canvas to CSS size. Not pixel truth.
 */
export function PageInkCanvas({
  engine,
  rasterId,
  className,
  displayWidth = 216,
  inkFrame = 0,
}: PageInkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const paint = () => {
      const el = canvasRef.current;
      if (!el) {
        return;
      }
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const displayHeight = Math.round((displayWidth * 1700) / 1200);
      const pixelW = Math.round(displayWidth * dpr);
      const pixelH = Math.round(displayHeight * dpr);
      if (el.width !== pixelW || el.height !== pixelH) {
        el.width = pixelW;
        el.height = pixelH;
        el.style.width = `${displayWidth}px`;
        el.style.height = `${displayHeight}px`;
      }

      const ctx = el.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      engine.paintDisplay(ctx, rasterId, displayWidth, displayHeight);
    };

    painters.set(rasterId, paint);
    paint();
    return () => {
      if (painters.get(rasterId) === paint) {
        painters.delete(rasterId);
      }
    };
  }, [engine, rasterId, displayWidth, inkFrame]);

  return <canvas ref={canvasRef} className={className} style={{ display: 'block' }} aria-hidden />;
}
