import { Gesture } from 'react-native-gesture-handler';
import type {
  GestureStateChangeEvent,
  GestureUpdateEvent,
  PanGestureHandlerEventPayload,
} from 'react-native-gesture-handler';

import type { PointerKind } from '../domain/types';
import {
  createPointerKindTracker,
  pressureFromNative,
  type NativePointerLike,
} from './nativePointer';

export type PointerSample = {
  pageX: number;
  pageY: number;
  kind: PointerKind;
  pressure: number;
  pointerCount: number;
  native: NativePointerLike;
};

type Tracker = ReturnType<typeof createPointerKindTracker>;

function debugPointer(hypothesisId: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch('http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '442aa5' },
    body: JSON.stringify({
      sessionId: '442aa5',
      runId: 'pencil-idle',
      hypothesisId,
      location: 'src/input/pointerGestures.ts',
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

function nativeFromGesture(event: {
  pointerType?: number | string;
  stylusData?: NativePointerLike['stylusData'];
  identifier?: number;
  pointerId?: number;
}): NativePointerLike {
  return {
    pointerType: event.pointerType,
    stylusData: event.stylusData,
    altitudeAngle: event.stylusData?.altitudeAngle,
    azimuthAngle: event.stylusData?.azimuthAngle,
    pressure: event.stylusData?.pressure,
    identifier: event.identifier,
    pointerId: event.pointerId,
  };
}

export function sampleFromPanEvent(
  event: GestureUpdateEvent<PanGestureHandlerEventPayload> | GestureStateChangeEvent<PanGestureHandlerEventPayload>,
  tracker: Tracker,
): PointerSample {
  const native = nativeFromGesture(event);
  return {
    pageX: event.absoluteX,
    pageY: event.absoluteY,
    kind: tracker.classify(native),
    pressure: pressureFromNative(native),
    pointerCount: event.numberOfPointers,
    native,
  };
}

/**
 * Apple Pencil と指を RNGH の pointerType で分岐する Pan。
 * コールバックは JS スレッド（既存の React state 更新をそのまま使う）。
 * manualActivation は使わない（Reanimated の setGestureState が要るため）。
 */
export function pointerPanGesture(options: {
  tracker: Tracker;
  heldRef: { current: boolean };
  onGrant: (sample: PointerSample) => void;
  onMove: (sample: PointerSample) => void;
  onRelease: (sample: PointerSample) => void;
  shouldCapture?: (sample: PointerSample) => boolean;
}) {
  return Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .maxPointers(2)
    .cancelsTouchesInView(false)
    .onTouchesDown((event) => {
      debugPointer('G', 'onTouchesDown', {
        pointerType: event.pointerType,
        numberOfTouches: event.numberOfTouches,
        state: event.state,
      });
    })
    .onBegin((event) => {
      const sample = sampleFromPanEvent(event, options.tracker);
      const capture = !options.shouldCapture || options.shouldCapture(sample);
      debugPointer('H', 'onBegin', {
        pointerType: event.pointerType,
        kind: sample.kind,
        pageX: sample.pageX,
        pageY: sample.pageY,
        capture,
        x: event.x,
        y: event.y,
        absoluteX: event.absoluteX,
        absoluteY: event.absoluteY,
      });
      if (!capture) {
        options.heldRef.current = false;
        return;
      }
      options.heldRef.current = true;
      options.onGrant(sample);
    })
    .onUpdate((event) => {
      if (!options.heldRef.current) {
        debugPointer('J', 'onUpdate skipped heldRef', { pointerType: event.pointerType });
        return;
      }
      const sample = sampleFromPanEvent(event, options.tracker);
      debugPointer('J', 'onUpdate', {
        kind: sample.kind,
        pageX: sample.pageX,
        pageY: sample.pageY,
        pointerCount: sample.pointerCount,
      });
      options.onMove(sample);
    })
    .onFinalize((event) => {
      if (!options.heldRef.current) {
        return;
      }
      options.heldRef.current = false;
      options.onRelease(sampleFromPanEvent(event, options.tracker));
    });
}

export function pointerPinchGesture(options: {
  onStart: () => void;
  onPinch: (scale: number) => void;
  onEnd?: () => void;
}) {
  return Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      options.onStart();
    })
    .onUpdate((event) => {
      options.onPinch(event.scale);
    })
    .onFinalize(() => {
      options.onEnd?.();
    });
}
