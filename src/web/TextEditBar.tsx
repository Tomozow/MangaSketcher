'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import type { TextId } from '@/src/domain/types';
import { isTextContentEmpty } from '@/src/domain/text';
import {
  planTextCommit,
  TEXT_EDIT_MARGIN_PX,
  TEXT_EDIT_MIN_HEIGHT_PX,
  TEXT_EDIT_MIN_WIDTH_PX,
  textEditHudPose,
  hudScreenFontPx,
} from '@/src/web/textEditCommit';
import {
  PAGE_TEXT_CHROME_ATTR,
  PAGE_TEXT_CONFIRM_ATTR,
  PAGE_TEXT_COPY_ATTR,
  PAGE_TEXT_DELETE_ATTR,
  PAGE_TEXT_EDIT_HUD_ATTR,
  PAGE_TEXT_ID_ATTR,
  PAGE_TEXT_WRAP_ATTR,
} from '@/src/web/gestures/pageTextDom';
import { styles } from '@/src/web/editorStyles';
import { setLiveTextContent } from '@/src/web/liveTextContentStore';
import { repaintAllInkDisplays } from '@/src/web/ink/PageInkCanvas';
import { isWhiteTextColor } from '@/src/web/text/whiteTextColor';

export type TextEditSelection = {
  id: TextId;
  content: string;
  color?: string;
};

type TextEditBarProps = {
  selection: TextEditSelection | null;
  layoutKey: unknown;
  onCommit: (textId: TextId, content: string) => void;
  onDeleteText: (textId: TextId) => void;
  onDuplicateText: (textId: TextId) => void;
  onFinish: () => void;
  onEditingChange: (editing: boolean) => void;
  onLiveContent: (content: string | null) => void;
};

type HudPose = { left: number; top: number; width: number; height: number; fontSize: number };

function visualViewRect(): { left: number; top: number; width: number; height: number } {
  if (typeof window === 'undefined') {
    return { left: 0, top: 0, width: TEXT_EDIT_MIN_WIDTH_PX, height: TEXT_EDIT_MIN_HEIGHT_PX };
  }
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

function wrapHudMetrics(wrap: HTMLElement): HudPose {
  const view = visualViewRect();
  const rect = wrap.getBoundingClientRect();
  const pose = textEditHudPose(rect, view);
  const wrapFont = Number.parseFloat(window.getComputedStyle(wrap).fontSize);
  const fontSize = hudScreenFontPx(
    Number.isFinite(wrapFont) && wrapFont > 0 ? wrapFont : 16,
    wrap.offsetHeight,
    rect.height,
  );
  return {
    left: pose.left,
    top: pose.top,
    width: Math.ceil(pose.width),
    height: Math.ceil(pose.height),
    fontSize,
  };
}

function applyHudPose(next: HudPose, bar: HTMLDivElement | null, input: HTMLTextAreaElement | null): void {
  if (bar) {
    bar.style.left = `${next.left}px`;
    bar.style.top = `${next.top}px`;
    bar.style.width = `${next.width}px`;
    bar.style.height = `${next.height}px`;
  }
  if (input) {
    input.style.width = `${next.width}px`;
    input.style.height = `${next.height}px`;
    input.style.fontSize = `${next.fontSize}px`;
  }
}

export function TextEditBar({
  selection,
  layoutKey,
  onCommit,
  onDeleteText,
  onDuplicateText,
  onFinish,
  onEditingChange,
  onLiveContent,
}: TextEditBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [pose, setPose] = useState<HudPose | null>(null);
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
    lastCommittedRef.current =
      editingId && !isTextContentEmpty(savedContent)
        ? { id: editingId, content: savedContent }
        : null;
    if (!selection) {
      onLiveContent(null);
      setLiveTextContent(null);
      onEditingChange(false);
      return;
    }
    onLiveContent(savedContent);
    if (editingId) {
      setLiveTextContent({ id: editingId, content: savedContent });
    }
    onEditingChange(true);
    return () => {
      if (!editingId) {
        return;
      }
      composingRef.current = false;
      commitDraft(editingId, savedContent, true);
    };
  }, [commitDraft, onEditingChange, onLiveContent, selection?.id]);

  useLayoutEffect(() => {
    if (!selection) {
      return;
    }
    textareaRef.current?.focus({ preventScroll: true });
  }, [selection?.id]);

  useLayoutEffect(() => {
    const wrap = selection
      ? document.querySelector<HTMLElement>(
          `[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}="${selection.id}"]`,
        )
      : null;
    const next = wrap ? wrapHudMetrics(wrap) : null;
    if (!next) {
      return;
    }
    applyHudPose(next, barRef.current, textareaRef.current);
    setPose((prev) => {
      if (
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.fontSize === next.fontSize
      ) {
        return prev;
      }
      return next;
    });
  }, [draft, selection?.id]);

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
      const next = wrapHudMetrics(wrap);
      applyHudPose(next, barRef.current, textareaRef.current);
      setPose(next);
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
      const confirmButtons = Array.from(document.querySelectorAll<HTMLElement>(`[${PAGE_TEXT_CONFIRM_ATTR}]`));
      if (confirmButtons.some(pointHits)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        commitDraft(selection.id, selection.content, true);
        onEditingChange(false);
        onFinish();
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
  }, [commitDraft, onDeleteText, onDuplicateText, onEditingChange, onFinish, selection?.id]);

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
    const liveId = selectionRef.current?.id;
    if (liveId) {
      setLiveTextContent({ id: liveId, content: value });
    }
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
    onLiveContent(value);
    const current = selectionRef.current;
    if (current) {
      setLiveTextContent({ id: current.id, content: value });
    }
  };

  if (!selection) {
    return null;
  }

  const view = visualViewRect();
  const barStyle: CSSProperties = pose
    ? { left: pose.left, top: pose.top, width: pose.width, height: pose.height }
    : {
        left: view.left + TEXT_EDIT_MARGIN_PX,
        top: view.top + TEXT_EDIT_MARGIN_PX,
        width: TEXT_EDIT_MIN_WIDTH_PX,
        height: TEXT_EDIT_MIN_HEIGHT_PX,
      };
  const hudColor = isWhiteTextColor(selection.color) ? '#1A1A1A' : selection.color || '#1A1A1A';

  return (
    <div
      ref={barRef}
      className={styles.textEditBar}
      style={barStyle}
      data-testid="text-edit-bar"
      {...{ [PAGE_TEXT_EDIT_HUD_ATTR]: '' }}
    >
      <textarea
        ref={textareaRef}
        className={styles.textEditInput}
        value={draft}
        autoFocus
        aria-label="テキスト編集"
        style={{
          fontSize: pose?.fontSize,
          color: hudColor,
          width: pose?.width,
          height: pose?.height,
        }}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    </div>
  );
}
