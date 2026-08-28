export type TextCommitPlan =
  | { kind: 'skip'; reason: 'not-explicit' | 'composing' | 'unchanged' }
  | { kind: 'commit'; content: string };

/** §3.4: commit only on explicit focusout/完了, after composition, if changed. */
export function planTextCommit(input: {
  draft: string;
  savedContent: string;
  composing: boolean;
  explicit: boolean;
}): TextCommitPlan {
  if (!input.explicit) {
    return { kind: 'skip', reason: 'not-explicit' };
  }
  if (input.composing) {
    return { kind: 'skip', reason: 'composing' };
  }
  if (input.draft === input.savedContent) {
    return { kind: 'skip', reason: 'unchanged' };
  }
  return { kind: 'commit', content: input.draft };
}

export const TEXT_TAP_SLOP_PX = 8;
