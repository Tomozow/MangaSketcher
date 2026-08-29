export type TextCommitPlan =
  | { kind: 'skip'; reason: 'not-explicit' | 'composing' | 'unchanged' }
  | { kind: 'commit'; content: string };

/** §3.4: persist on explicit focusout after composition, if changed. */
export function planTextCommit(input: {
  draft: string;
  savedContent: string;
  composing: boolean;
  explicit: boolean;
  /** IME 変換中でも確定する（フォーカス喪失時の後追いなど） */
  forceOnExplicit?: boolean;
}): TextCommitPlan {
  if (!input.explicit) {
    return { kind: 'skip', reason: 'not-explicit' };
  }
  if (input.composing && !input.forceOnExplicit) {
    return { kind: 'skip', reason: 'composing' };
  }
  if (input.draft === input.savedContent) {
    return { kind: 'skip', reason: 'unchanged' };
  }
  return { kind: 'commit', content: input.draft };
}

export const TEXT_TAP_SLOP_PX = 8;
export const TEXT_EDIT_GAP_PX = 8;
export const TEXT_EDIT_MIN_WIDTH_PX = 240;
export const TEXT_EDIT_MIN_HEIGHT_PX = 44;
export const TEXT_EDIT_MARGIN_PX = 8;

/** Grow the horizontal IME textarea to the draft. Clamp so it stays on screen. */
export function fitTextEditInputHeight(
  scrollHeight: number,
  minHeight = TEXT_EDIT_MIN_HEIGHT_PX,
  maxHeight = Number.POSITIVE_INFINITY,
): number {
  const floor = Math.max(1, minHeight);
  const ceiling = Math.max(floor, maxHeight);
  return Math.min(ceiling, Math.max(floor, scrollHeight));
}

export function textEditBarPose(
  wrapRect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  view: { left: number; top: number; width: number; height: number },
  barHeight: number,
): { left: number; top: number; width: number } {
  const width = Math.min(
    Math.max(TEXT_EDIT_MIN_WIDTH_PX, wrapRect.width),
    Math.max(44, view.width - TEXT_EDIT_MARGIN_PX * 2),
  );
  const maxLeft = view.left + view.width - TEXT_EDIT_MARGIN_PX - width;
  const left = Math.min(Math.max(view.left + TEXT_EDIT_MARGIN_PX, wrapRect.left), maxLeft);
  const maxTop = view.top + view.height - TEXT_EDIT_MARGIN_PX - barHeight;
  const top = Math.min(Math.max(view.top + TEXT_EDIT_MARGIN_PX, wrapRect.bottom + TEXT_EDIT_GAP_PX), maxTop);
  return { left, top, width };
}
