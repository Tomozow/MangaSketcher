'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TextId } from '@/src/domain/types';
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
  onEditingChange: (editing: boolean) => void;
};

export function TextEditBar({ selection, viewportBottom, onCommit, onEditingChange }: TextEditBarProps) {
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

  const runExplicitCommit = useCallback(() => {
    const current = selectionRef.current;
    if (!current) {
      return;
    }
    const plan = planTextCommit({
      draft,
      savedContent: current.content,
      composing: composingRef.current,
      explicit: true,
    });
    if (plan.kind === 'commit') {
      onCommit(current.id, plan.content);
    } else if (plan.reason === 'composing') {
      pendingExplicitCommitRef.current = true;
    }
  }, [draft, onCommit]);

  const handleDone = () => {
    runExplicitCommit();
    textareaRef.current?.blur();
  };

  const handleBlur = () => {
    onEditingChange(false);
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
