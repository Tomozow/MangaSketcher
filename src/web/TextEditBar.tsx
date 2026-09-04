'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import type { TextId } from '@/src/domain/types';
import { isTextContentEmpty, mapIndexAfterNewlineNormalize, normalizeEditNewlines } from '@/src/domain/text';
import { TEXT_WRAP_LINE_HEIGHT, layoutVisibleTextBox, verticalCaretCell } from '@/src/domain/textWrap';
import { isWhiteTextColor } from '@/src/web/text/whiteTextColor';
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

function hudCaretCell(
  value: string,
  utf16Index: number,
  wrap: HTMLElement | null,
  pose: HudPose | null,
  input: HTMLTextAreaElement | null,
): { column: number; row: number } {
  const wrapFont = wrap ? Number.parseFloat(window.getComputedStyle(wrap).fontSize) : NaN;
  const fontSize = wrapFont > 0 ? wrapFont : (pose?.fontSize ?? 16);
  const wrapW = wrap?.offsetWidth ?? pose?.width ?? input?.offsetWidth ?? 1;
  const wrapH = wrap?.offsetHeight ?? pose?.height ?? input?.offsetHeight ?? 1;
  const fitted = layoutVisibleTextBox(
    { x: 0, y: 0, width: Math.max(1, wrapW), height: Math.max(1, wrapH) },
    value,
    fontSize,
  );
  return verticalCaretCell(
    value,
    utf16Index,
    { x: 0, y: 0, width: fitted.width, height: fitted.height },
    fontSize,
  );
}

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
  const start = input?.selectionStart;
  const end = input?.selectionEnd;
  const dir = input?.selectionDirection;
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
    if (start != null && end != null) {
      try {
        input.setSelectionRange(start, end, dir);
      } catch {
        input.setSelectionRange(start, end);
      }
    }
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
  const [caret, setCaret] = useState({ column: 0, row: 0, range: false });
  const composingRef = useRef(false);
  const pendingExplicitCommitRef = useRef(false);
  const suppressBlurRef = useRef(false);
  const selectionRef = useRef(selection);
  const draftRef = useRef(draft);
  const lastCommittedRef = useRef<{ id: TextId; content: string } | null>(null);
  selectionRef.current = selection;
  draftRef.current = draft;

  const syncCaret = useCallback(() => {
    const el = textareaRef.current;
    const wrap = selectionRef.current
      ? document.querySelector<HTMLElement>(
          `[${PAGE_TEXT_WRAP_ATTR}][${PAGE_TEXT_ID_ATTR}="${selectionRef.current.id}"]`,
        )
      : null;
    const value = el?.value ?? draftRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const cell = hudCaretCell(value, start, wrap, pose, el);
    setCaret({ ...cell, range: start !== end });
  }, [pose]);

  const commitDraft = useCallback(
    (textId: TextId, savedContent: string, forceOnExplicit: boolean) => {
      const content = normalizeEditNewlines(textareaRef.current?.value ?? draftRef.current);
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
    syncCaret();
  }, [draft, pose, selection?.id, syncCaret]);

  useEffect(() => {
    document.addEventListener('selectionchange', syncCaret);
    return () => document.removeEventListener('selectionchange', syncCaret);
  }, [syncCaret]);

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
    const el = textareaRef.current;
    if (!el || !selection) {
      return;
    }
    const onInput = (event: Event) => {
      const e = event as InputEvent;
      if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') {
        return;
      }
      const at = el.selectionStart ?? 0;
      if (el.value[at] !== '\n' && el.value[at] !== '\r') {
        return;
      }
      const next = at + (el.value[at] === '\r' && el.value[at + 1] === '\n' ? 2 : 1);
      el.setSelectionRange(next, next);
    };
    el.addEventListener('input', onInput);
    return () => el.removeEventListener('input', onInput);
  }, [selection?.id]);

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
    const hud = textareaRef.current;
    if (hud) {
      const normalized = normalizeEditNewlines(hud.value);
      if (normalized !== hud.value) {
        const start = mapIndexAfterNewlineNormalize(hud.value, hud.selectionStart ?? 0);
        const end = mapIndexAfterNewlineNormalize(hud.value, hud.selectionEnd ?? 0);
        hud.value = normalized;
        hud.setSelectionRange(start, end);
      }
    }
    const value = textareaRef.current?.value ?? draft;
    setDraft(value);
    onLiveContent(value);
    const liveId = selectionRef.current?.id;
    if (liveId) {
      setLiveTextContent({ id: liveId, content: value });
    }
    syncCaret();
    if (pendingExplicitCommitRef.current) {
      pendingExplicitCommitRef.current = false;
      const current = selectionRef.current;
      if (current) {
        commitDraft(current.id, current.content, true);
      }
    }
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const raw = event.target.value;
    const value = normalizeEditNewlines(raw);
    const selStartRaw = event.target.selectionStart;
    const selEndRaw = event.target.selectionEnd;
    if (raw !== value) {
      const start = mapIndexAfterNewlineNormalize(raw, selStartRaw ?? 0);
      const end = mapIndexAfterNewlineNormalize(raw, selEndRaw ?? 0);
      event.target.value = value;
      event.target.setSelectionRange(start, end);
    }
    setDraft(value);
    onLiveContent(value);
    const current = selectionRef.current;
    if (current) {
      setLiveTextContent({ id: current.id, content: value });
    }
    requestAnimationFrame(() => {
      syncCaret();
    });
  };

  if (!selection) {
    return null;
  }

  const view = visualViewRect();
  const barStyle: CSSProperties = pose
    ? {
        left: pose.left,
        top: pose.top,
        width: pose.width,
        height: pose.height,
        fontSize: pose.fontSize,
      }
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
          width: pose?.width,
          height: pose?.height,
        }}
        onChange={handleChange}
        onSelect={syncCaret}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
      {caret.range ? null : (
        <div
          className={styles.textEditCaret}
          aria-hidden="true"
          style={{
            right: `${caret.column * TEXT_WRAP_LINE_HEIGHT}em`,
            top: `${caret.row}em`,
            width: `${TEXT_WRAP_LINE_HEIGHT}em`,
            height: 2,
            background: hudColor,
            boxShadow: isWhiteTextColor(selection.color) ? '0 0 0 1px #000000' : undefined,
          }}
        />
      )}
    </div>
  );
}
