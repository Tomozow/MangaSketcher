'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import type { TextId } from '@/src/domain/types';
import {
  fitTextEditInputHeight,
  planTextCommit,
  TEXT_EDIT_MIN_HEIGHT_PX,
  TEXT_EDIT_MIN_WIDTH_PX,
  textEditBarPose,
} from '@/src/web/textEditCommit';
import {
  PAGE_TEXT_CHROME_ATTR,
  PAGE_TEXT_COPY_ATTR,
  PAGE_TEXT_DELETE_ATTR,
  PAGE_TEXT_ID_ATTR,
  PAGE_TEXT_WRAP_ATTR,
} from '@/src/web/gestures/pageTextDom';
import { styles } from '@/src/web/editorStyles';
import { repaintAllInkDisplays } from '@/src/web/ink/PageInkCanvas';
import { ipadDebugLog } from '@/src/web/ipadDebugLog';

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

function fitBarInput(input: HTMLTextAreaElement, viewHeight: number): void {
  input.style.height = 'auto';
  const maxHeight = Math.max(TEXT_EDIT_MIN_HEIGHT_PX, Math.floor(viewHeight * 0.5));
  input.style.height = `${fitTextEditInputHeight(input.scrollHeight, TEXT_EDIT_MIN_HEIGHT_PX, maxHeight)}px`;
}

// #region agent log
const AGENT_DEBUG_INGEST = 'http://127.0.0.1:7901/ingest/54982627-aba6-43f1-b873-18d991fc1426';
let textEditBarDebugCount = 0;
function textEditBarDebug(hypothesisId: string, location: string, message: string, data: Record<string, unknown>): void {
  if (textEditBarDebugCount >= 12) {
    return;
  }
  textEditBarDebugCount += 1;
  ipadDebugLog({
    sessionId: '183625',
    ingest: AGENT_DEBUG_INGEST,
    runId: 'pre-fix',
    hypothesisId,
    location,
    message,
    data: { n: textEditBarDebugCount, ...data },
    timestamp: Date.now(),
  });
}
// #endregion

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
  const prevLiveCbRef = useRef(onLiveContent);
  const prevEditCbRef = useRef(onEditingChange);
  const prevEditingIdRef = useRef<TextId | undefined>(undefined);
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
        // #region agent log
        textEditBarDebug('B', 'TextEditBar.tsx:commitDraft', 'commitDraft dispatch', {
          textId,
          draftLen: content.length,
          savedLen: savedContent.length,
          textareaLen: textareaRef.current?.value.length ?? -1,
        });
        // #endregion
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
    // #region agent log
    const liveCbChanged = prevLiveCbRef.current !== onLiveContent;
    const editCbChanged = prevEditCbRef.current !== onEditingChange;
    prevLiveCbRef.current = onLiveContent;
    prevEditCbRef.current = onEditingChange;
    textEditBarDebug('A', 'TextEditBar.tsx:selection-effect', 'selection effect run', {
      editingId: editingId ?? null,
      prevEditingId: prevEditingIdRef.current ?? null,
      idChanged: prevEditingIdRef.current !== editingId,
      savedLen: savedContent.length,
      liveCbChanged,
      editCbChanged,
      toolSelection: Boolean(selection),
    });
    prevEditingIdRef.current = editingId;
    // #endregion
    setDraft(savedContent);
    pendingExplicitCommitRef.current = false;
    lastCommittedRef.current = editingId ? { id: editingId, content: savedContent } : null;
    if (!selection) {
      onLiveContent(null);
      return;
    }
    onLiveContent(savedContent);
    // #region agent log
    textEditBarDebug('C', 'TextEditBar.tsx:onEditingChange', 'onEditingChange(true)', {
      editingId,
    });
    // #endregion
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
      const view = visualViewRect();
      const input = textareaRef.current;
      if (input) {
        fitBarInput(input, view.height);
      }
      const barHeight = barRef.current?.getBoundingClientRect().height || TEXT_EDIT_MIN_HEIGHT_PX;
      setPose(textEditBarPose(wrap.getBoundingClientRect(), view, barHeight));
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

  useLayoutEffect(() => {
    if (!selection) {
      return;
    }
    const input = textareaRef.current;
    if (!input) {
      return;
    }
    const view = visualViewRect();
    fitBarInput(input, view.height);
    const wrap = document.querySelector<HTMLElement>(
      `[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}="${selection.id}"]`,
    );
    if (!wrap) {
      return;
    }
    const barHeight = barRef.current?.getBoundingClientRect().height || TEXT_EDIT_MIN_HEIGHT_PX;
    setPose(textEditBarPose(wrap.getBoundingClientRect(), view, barHeight));
  }, [draft, pose?.width, selection?.id]);

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
      const copyButtons = Array.from(document.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_COPY_ATTR}]`));
      if (copyButtons.some(pointHits)) {
        suppressBlurRef.current = true;
        event.preventDefault();
        event.stopImmediatePropagation();
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
      const chrome = Array.from(document.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_CHROME_ATTR}]`));
      if (chrome.some(pointHits)) {
        suppressBlurRef.current = true;
        event.preventDefault();
        event.stopImmediatePropagation();
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
    repaintAllInkDisplays();
    requestAnimationFrame(() => {
      repaintAllInkDisplays();
    });
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
        rows={1}
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
