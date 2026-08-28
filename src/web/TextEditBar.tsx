'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TextId } from '@/src/domain/types';
import { isTextContentEmpty } from '@/src/domain/text';
import { planTextCommit } from '@/src/web/textEditCommit';
import { PAGE_TEXT_CHROME_ATTR, PAGE_TEXT_COPY_ATTR, PAGE_TEXT_DELETE_ATTR } from '@/src/web/gestures/pageTextDom';
import { styles } from '@/src/web/editorStyles';

export type TextEditSelection = {
  id: TextId;
  content: string;
};

type TextEditBarProps = {
  selection: TextEditSelection | null;
  viewportBottom: number;
  onCommit: (textId: TextId, content: string) => void;
  onDeleteText: (textId: TextId) => void;
  onDuplicateText: (textId: TextId) => void;
  onEditingChange: (editing: boolean) => void;
};

export function TextEditBar({
  selection,
  viewportBottom,
  onCommit,
  onDeleteText,
  onDuplicateText,
  onEditingChange,
}: TextEditBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const composingRef = useRef(false);
  const pendingExplicitCommitRef = useRef(false);
  const suppressBlurRef = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    setDraft(selection?.content ?? '');
    pendingExplicitCommitRef.current = false;
    if (!selection) {
      return;
    }
    onEditingChange(true);
    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [onEditingChange, selection?.id]);

  useEffect(() => {
    if (!selection) return;
    const capturePointerDown = (event: PointerEvent) => {
      const pointHits = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        );
      };
      const chrome = Array.from(document.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_CHROME_ATTR}]`));
      if (chrome.some(pointHits)) {
        suppressBlurRef.current = true;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      const copyButtons = Array.from(document.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_COPY_ATTR}]`));
      if (copyButtons.some(pointHits)) {
        onDuplicateText(selection.id);
        onEditingChange(true);
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
        return;
      }
      const buttons = Array.from(document.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_DELETE_ATTR}]`));
      if (buttons.some(pointHits)) {
        onDeleteText(selection.id);
      }
    };
    document.addEventListener('pointerdown', capturePointerDown, true);
    return () => document.removeEventListener('pointerdown', capturePointerDown, true);
  }, [onDeleteText, onDuplicateText, onEditingChange, selection?.id]);

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
    if (current && isTextContentEmpty(textareaValue)) {
      onDeleteText(current.id);
      textareaRef.current?.blur();
      return;
    }
    runExplicitCommit({ forceOnExplicit: true });
    textareaRef.current?.blur();
  };

  const handleBlur = () => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return;
    }
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
