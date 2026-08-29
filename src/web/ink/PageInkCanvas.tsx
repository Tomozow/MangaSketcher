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
const livePaintQueued = new Set<string>();
let livePaintRaf = 0;
let keepAliveUsers = 0;
let keepAliveCleanup: (() => void) | null = null;

/** Paint the on-screen copy immediately (do not wait for React). */
export function repaintInkDisplay(rasterId: string): void {
  painters.get(rasterId)?.();
}

/** Blit every mounted display copy (iOS may drop the backing store without a size change). */
export function repaintAllInkDisplays(): void {
  for (const paint of painters.values()) {
    paint();
  }
}

function refreshInkDisplays(): void {
  repaintAllInkDisplays();
  if (typeof requestAnimationFrame !== 'function') {
    return;
  }
  requestAnimationFrame(() => {
    repaintAllInkDisplays();
  });
}

function retainInkDisplayKeepAlive(): void {
  keepAliveUsers += 1;
  if (keepAliveUsers !== 1 || typeof window === 'undefined') {
    return;
  }
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', refreshInkDisplays);
  viewport?.addEventListener('scroll', refreshInkDisplays);
  window.addEventListener('resize', refreshInkDisplays);
  window.addEventListener('pageshow', refreshInkDisplays);
  document.addEventListener('visibilitychange', refreshInkDisplays);
  keepAliveCleanup = () => {
    viewport?.removeEventListener('resize', refreshInkDisplays);
    viewport?.removeEventListener('scroll', refreshInkDisplays);
    window.removeEventListener('resize', refreshInkDisplays);
    window.removeEventListener('pageshow', refreshInkDisplays);
    document.removeEventListener('visibilitychange', refreshInkDisplays);
  };
}

function releaseInkDisplayKeepAlive(): void {
  keepAliveUsers = Math.max(0, keepAliveUsers - 1);
  if (keepAliveUsers > 0) {
    return;
  }
  keepAliveCleanup?.();
  keepAliveCleanup = null;
}

/** Coalesce live overlay paints to one display blit per animation frame. */
export function scheduleInkDisplay(rasterId: string): void {
  livePaintQueued.add(rasterId);
  if (livePaintRaf) {
    return;
  }
  livePaintRaf = requestAnimationFrame(() => {
    livePaintRaf = 0;
    const ids = [...livePaintQueued];
    livePaintQueued.clear();
    for (const id of ids) {
      painters.get(id)?.();
    }
  });
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
      const dims = engine.getRasterDimensions(rasterId);
      const displayHeight = Math.max(
        1,
        Math.round((displayWidth * dims.height) / Math.max(1, dims.width)),
      );
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
    retainInkDisplayKeepAlive();
    paint();

    const el = canvasRef.current;
    const onContextEvent = () => {
      refreshInkDisplays();
    };
    el?.addEventListener('contextlost', onContextEvent);
    el?.addEventListener('contextrestored', onContextEvent);

    return () => {
      el?.removeEventListener('contextlost', onContextEvent);
      el?.removeEventListener('contextrestored', onContextEvent);
      if (painters.get(rasterId) === paint) {
        painters.delete(rasterId);
      }
      releaseInkDisplayKeepAlive();
    };
  }, [engine, rasterId, displayWidth]);

  useEffect(() => {
    painters.get(rasterId)?.();
  }, [inkFrame, rasterId]);

  return <canvas ref={canvasRef} className={className} style={{ display: 'block' }} aria-hidden />;
}
