'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import type { TextId } from '@/src/domain/types';
import { planTextCommit, TEXT_EDIT_MIN_WIDTH_PX, textEditBarPose } from '@/src/web/textEditCommit';
import {
  PAGE_TEXT_CHROME_ATTR,
  PAGE_TEXT_COPY_ATTR,
  PAGE_TEXT_DELETE_ATTR,
  PAGE_TEXT_ID_ATTR,
  PAGE_TEXT_WRAP_ATTR,
} from '@/src/web/gestures/pageTextDom';
import { styles } from '@/src/web/editorStyles';

export type TextEditSelection = {
  id: TextId;
  content: string;
};

type TextEditBarProps = {
  selection: TextEditSelection | null;
  layoutKey: unknown;
  onCommit: (textId: TextId, content: string) => void;
  onDeleteText: (textId: TextId) => void;
  onDuplicateText: (textId: TextId) => void;
  onEditingChange: (editing: boolean) => void;
  onLiveContent: (content: string | null) => void;
};

function visualViewRect(): { left: number; top: number; width: number; height: number } {
  const viewport = window.visualViewport;
  if (!viewport) {
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  return {
    left: viewport.offsetLeft,
    top: viewport.offsetTop,
    width: viewport.width,
    height: viewport.height,
  };
}

export function TextEditBar({
  selection,
  layoutKey,
  onCommit,
  onDeleteText,
  onDuplicateText,
  onEditingChange,
  onLiveContent,
}: TextEditBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [pose, setPose] = useState<{ left: number; top: number; width: number } | null>(null);
  const composingRef = useRef(false);
  const pendingExplicitCommitRef = useRef(false);
  const suppressBlurRef = useRef(false);
  const selectionRef = useRef(selection);
  const draftRef = useRef(draft);
  const lastCommittedRef = useRef<{ id: TextId; content: string } | null>(null);
  selectionRef.current = selection;
  draftRef.current = draft;

  const commitDraft = useCallback(
    (textId: TextId, savedContent: string, forceOnExplicit: boolean) => {
      const content = textareaRef.current?.value ?? draftRef.current;
      if (lastCommittedRef.current?.id === textId && lastCommittedRef.current.content === content) {
        return;
      }
      const plan = planTextCommit({
        draft: content,
        savedContent,
        composing: composingRef.current,
        explicit: true,
        forceOnExplicit,
      });
      if (plan.kind === 'commit') {
        lastCommittedRef.current = { id: textId, content: plan.content };
        onCommit(textId, plan.content);
        return;
      }
      if (plan.reason === 'composing') {
        pendingExplicitCommitRef.current = true;
      }
    },
    [onCommit],
  );

  useEffect(() => {
    const editingId = selection?.id;
    const savedContent = selection?.content ?? '';
    setDraft(savedContent);
    pendingExplicitCommitRef.current = false;
    lastCommittedRef.current = editingId ? { id: editingId, content: savedContent } : null;
    if (!selection) {
      onLiveContent(null);
      return;
    }
    onLiveContent(savedContent);
    onEditingChange(true);
    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (!editingId) {
        return;
      }
      composingRef.current = false;
      commitDraft(editingId, savedContent, true);
    };
  }, [commitDraft, onEditingChange, onLiveContent, selection?.id]);

  useLayoutEffect(() => {
    if (!selection) {
      setPose(null);
      return;
    }

    const update = () => {
      const wrap = document.querySelector<HTMLElement>(
        `[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}="${selection.id}"]`,
      );
      if (!wrap) {
        setPose(null);
        return;
      }
      const barHeight = barRef.current?.getBoundingClientRect().height || 52;
      setPose(textEditBarPose(wrap.getBoundingClientRect(), visualViewRect(), barHeight));
    };

    update();
    const frame = requestAnimationFrame(update);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    const wrap = document.querySelector<HTMLElement>(
      `[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}="${selection.id}"]`,
    );
    const observer = wrap ? new ResizeObserver(update) : null;
    if (wrap && observer) {
      observer.observe(wrap);
    }
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [layoutKey, selection?.id]);

  useEffect(() => {
    if (!selection) return;
    const capturePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && barRef.current?.contains(target)) {
        return;
      }
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
        return;
      }
      const copyButtons = Array.from(document.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_COPY_ATTR}]`));
      if (copyButtons.some(pointHits)) {
        commitDraft(selection.id, selection.content, true);
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
        return;
      }
      textareaRef.current?.blur();
    };
    document.addEventListener('pointerdown', capturePointerDown, true);
    return () => document.removeEventListener('pointerdown', capturePointerDown, true);
  }, [commitDraft, onDeleteText, onDuplicateText, onEditingChange, selection?.id]);

  const handleBlur = () => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return;
    }
    onEditingChange(false);
    const current = selectionRef.current;
    if (current) {
      commitDraft(current.id, current.content, true);
    }
  };

  const handleFocus = () => {
    onEditingChange(true);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    const value = textareaRef.current?.value ?? draft;
    onLiveContent(value);
    if (pendingExplicitCommitRef.current) {
      pendingExplicitCommitRef.current = false;
      const current = selectionRef.current;
      if (current) {
        commitDraft(current.id, current.content, true);
      }
    }
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft(value);
    if (!composingRef.current) {
      onLiveContent(value);
    }
  };

  if (!selection) {
    return null;
  }

  return (
    <div
      ref={barRef}
      className={styles.textEditBar}
      style={
        pose
          ? { left: pose.left, top: pose.top, width: pose.width }
          : { left: 0, top: -9999, width: TEXT_EDIT_MIN_WIDTH_PX }
      }
      data-testid="text-edit-bar"
    >
      <textarea
        ref={textareaRef}
        className={styles.textEditInput}
        value={draft}
        rows={2}
        aria-label="テキスト編集"
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    </div>
  );
}
