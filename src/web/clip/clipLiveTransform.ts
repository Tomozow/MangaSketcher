import type { ClipMeta } from '@/src/domain/types';

/** Ephemeral clip pose during drag (paintlet-style float); not in history until commit. */
export type ClipLiveTransform = {
  x: number;
  y: number;
  scale: number;
  scaleY: number;
  rotation: number;
};

export function effectiveClipPose(
  clip: ClipMeta,
  live?: ClipLiveTransform | null,
): ClipLiveTransform {
  const scale = live?.scale ?? clip.scale;
  return {
    x: live?.x ?? clip.x,
    y: live?.y ?? clip.y,
    scale,
    scaleY: live?.scaleY ?? clip.scaleY ?? scale,
    rotation: live?.rotation ?? clip.rotation,
  };
}

export function mergeClipLive(
  clip: ClipMeta,
  live: ClipLiveTransform | undefined,
  patch: Partial<ClipLiveTransform>,
): ClipLiveTransform {
  const base = effectiveClipPose(clip, live);
  return {
    x: patch.x ?? base.x,
    y: patch.y ?? base.y,
    scale: patch.scale ?? base.scale,
    scaleY: patch.scaleY ?? base.scaleY,
    rotation: patch.rotation ?? base.rotation,
  };
}
