'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TextId } from '@/src/domain/types';
import { isTextContentEmpty } from '@/src/domain/text';
import { planTextCommit } from '@/src/web/textEditCommit';
import styles from '@/src/web/editor.module.css';

export type TextEditSelection = {
  id: TextId;
  content: string;
};

type TextEditBarProps = {
  selection: TextEditSelection | null;
  viewportBottom: number;
  onCommit: (textId: TextId, content: string) => void;
  onDeleteText: (textId: TextId) => void;
  onEditingChange: (editing: boolean) => void;
};

export function TextEditBar({
  selection,
  viewportBottom,
  onCommit,
  onDeleteText,
  onEditingChange,
}: TextEditBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const composingRef = useRef(false);
  const pendingExplicitCommitRef = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    setDraft(selection?.content ?? '');
    pendingExplicitCommitRef.current = false;
    if (selection) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [selection?.id]);

  const runExplicitCommit = useCallback(
    (options?: { forceOnExplicit?: boolean }) => {
      const current = selectionRef.current;
      if (!current) {
        return;
      }
      const textareaValue = textareaRef.current?.value ?? draft;
      const plan = planTextCommit({
        draft: textareaValue,
        savedContent: current.content,
        composing: composingRef.current,
        explicit: true,
        forceOnExplicit: options?.forceOnExplicit,
      });
      // #region agent log
      fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'6c5c15',location:'TextEditBar.tsx:runExplicitCommit',message:'commit plan',data:{textId:current.id,draftLen:draft.length,textareaLen:textareaValue.length,draftMatchTextarea:draft===textareaValue,savedLen:current.content.length,composing:composingRef.current,forceOnExplicit:Boolean(options?.forceOnExplicit),planKind:plan.kind,planReason:plan.kind==='skip'?plan.reason:undefined},timestamp:Date.now(),hypothesisId:'B,C',runId:'post-fix'})}).catch(()=>{});
      // #endregion
      if (plan.kind === 'commit') {
        onCommit(current.id, plan.content);
      } else if (plan.reason === 'composing') {
        pendingExplicitCommitRef.current = true;
      }
    },
    [draft, onCommit],
  );

  const handleDone = () => {
    const current = selectionRef.current;
    const textareaValue = textareaRef.current?.value ?? draft;
    // #region agent log
    fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'6c5c15',location:'TextEditBar.tsx:handleDone',message:'done tapped',data:{textId:current?.id,draftLen:draft.length,textareaLen:textareaValue.length,draftEmpty:isTextContentEmpty(draft),textareaEmpty:isTextContentEmpty(textareaValue)},timestamp:Date.now(),hypothesisId:'B',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    if (current && isTextContentEmpty(textareaValue)) {
      onDeleteText(current.id);
      textareaRef.current?.blur();
      return;
    }
    runExplicitCommit({ forceOnExplicit: true });
    textareaRef.current?.blur();
  };

  const handleBlur = () => {
    onEditingChange(false);
    const current = selectionRef.current;
    const textareaValue = textareaRef.current?.value ?? draft;
    // #region agent log
    fetch('/api/debug-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'6c5c15',location:'TextEditBar.tsx:handleBlur',message:'textarea blur',data:{textId:current?.id,draftLen:draft.length,textareaLen:textareaValue.length,draftEmpty:isTextContentEmpty(draft),textareaEmpty:isTextContentEmpty(textareaValue)},timestamp:Date.now(),hypothesisId:'B',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    runExplicitCommit();
  };

  const handleFocus = () => {
    onEditingChange(true);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    if (pendingExplicitCommitRef.current) {
      pendingExplicitCommitRef.current = false;
      runExplicitCommit();
    }
  };

  if (!selection) {
    return null;
  }

  return (
    <div
      className={styles.textEditBar}
      style={{ bottom: viewportBottom }}
      data-testid="text-edit-bar"
    >
      <textarea
        ref={textareaRef}
        className={styles.textEditInput}
        value={draft}
        rows={2}
        aria-label="テキスト編集"
        onChange={(event) => setDraft(event.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
      <button type="button" className={styles.textEditDone} onClick={handleDone}>
        完了
      </button>
    </div>
  );
}
