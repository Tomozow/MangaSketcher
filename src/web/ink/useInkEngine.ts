'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { scheduleInkDisplay } from './PageInkCanvas';
import {
  InkEngine,
  THUMB_HEIGHT,
  THUMB_WIDTH,
  wireInkAutosave,
  type DrawTemplate,
  type InkAutosaveSink,
} from './InkEngine';

export type UseInkEngineOptions = {
  rasterWidth: number;
  rasterHeight: number;
  emptyPng: ArrayBuffer;
  /** All raster ids for the open document. */
  rasterIds: string[];
  /** Boot-time encoded PNG per raster id. */
  encodedByRasterId?: ReadonlyMap<string, ArrayBuffer>;
  drawTemplate?: DrawTemplate;
  autosaveSink?: InkAutosaveSink;
};

export type InkEngineApi = {
  engine: InkEngine;
  beginPenOverlay: InkEngine['beginPenOverlay'];
  bakePenOverlay: InkEngine['bakePenOverlay'];
  beginEraseDirect: InkEngine['beginEraseDirect'];
  finishEraseDirect: InkEngine['finishEraseDirect'];
  /** Returns undo PNG from the last stroke snapshot (same as bake/finish return). */
  takeStrokeUndoPng: (rasterId: string) => ArrayBuffer;
  /** Dispatch `commitInkBake` after bake/finish; this only bumps generation client-side. */
  commitInkBake: (rasterId: string) => { rasterId: string };
  getThumb: InkEngine['getThumb'];
  generateThumb: InkEngine['generateThumb'];
  invalidateThumb: InkEngine['invalidateThumb'];
  decode: InkEngine['decode'];
  thumbWidth: typeof THUMB_WIDTH;
  thumbHeight: typeof THUMB_HEIGHT;
  /** Bumped after clip raster sizes are known so overlay layout can match PNG pixels. */
  rasterLayoutGen: number;
};

/**
 * React mount point for InkEngine. Editor wires reducer + gestures later.
 * Viewport pin/decode is owned by WorkspaceStrip so pan does not re-register rasters.
 */
export function useInkEngine(options: UseInkEngineOptions): InkEngineApi {
  const autosaveRef = useRef(options.autosaveSink);
  autosaveRef.current = options.autosaveSink;

  const engine = useMemo(
    () =>
      new InkEngine({
        rasterWidth: options.rasterWidth,
        rasterHeight: options.rasterHeight,
        emptyPng: options.emptyPng,
        drawTemplate: options.drawTemplate,
      }),
    [options.rasterWidth, options.rasterHeight, options.emptyPng, options.drawTemplate],
  );

  useEffect(() => {
    const sink = autosaveRef.current;
    if (!sink) {
      return undefined;
    }
    return wireInkAutosave(engine, sink);
  }, [engine]);

  const [rasterLayoutGen, setRasterLayoutGen] = useState(0);

  useEffect(() => {
    engine.setCallbacks({
      onHotPixelsReady: (rasterId) => {
        scheduleInkDisplay(rasterId);
        setRasterLayoutGen((n) => n + 1);
      },
    });
  }, [engine]);

  useLayoutEffect(() => {
    for (const rasterId of options.rasterIds) {
      const encoded = options.encodedByRasterId?.get(rasterId);
      engine.registerRaster(rasterId, encoded);
    }
    setRasterLayoutGen((n) => n + 1);
  }, [engine, options.rasterIds, options.encodedByRasterId]);

  const takeStrokeUndoPng = useCallback(
    (rasterId: string) => engine.takeStrokeUndoPng(rasterId),
    [engine],
  );

  const commitInkBake = useCallback((rasterId: string) => ({ rasterId }), []);

  return useMemo(
    () => ({
      engine,
      beginPenOverlay: (rasterId: string) => engine.beginPenOverlay(rasterId),
      bakePenOverlay: (rasterId: string) => engine.bakePenOverlay(rasterId),
      beginEraseDirect: (rasterId: string) => engine.beginEraseDirect(rasterId),
      finishEraseDirect: (rasterId: string) => engine.finishEraseDirect(rasterId),
      takeStrokeUndoPng,
      commitInkBake,
      getThumb: (rasterId: string) => engine.getThumb(rasterId),
      generateThumb: (rasterId: string) => engine.generateThumb(rasterId),
      invalidateThumb: (rasterId: string) => engine.invalidateThumb(rasterId),
      decode: (rasterId: string) => engine.decode(rasterId),
      thumbWidth: THUMB_WIDTH,
      thumbHeight: THUMB_HEIGHT,
      rasterLayoutGen,
    }),
    [engine, takeStrokeUndoPng, commitInkBake, rasterLayoutGen],
  );
}
