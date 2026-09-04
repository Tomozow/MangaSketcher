import type { ToolId } from '../domain/types';
import { DEFAULT_SHORTCUTS, type ShortcutMap } from '../storage/appSettings';
import { isTypingTarget } from './desktopNavKeys';

export function toolShortcutMapFromSettings(
  shortcuts: Pick<ShortcutMap, 'pen' | 'eraser' | 'text' | 'select' | 'lasso' | 'scissors'> = DEFAULT_SHORTCUTS,
): Record<string, ToolId> {
  return {
    [shortcuts.pen]: 'pen',
    [shortcuts.eraser]: 'eraser',
    [shortcuts.text]: 'text',
    [shortcuts.select]: 'select',
    [shortcuts.lasso]: 'lasso',
    [shortcuts.scissors]: 'scissors',
  };
}

export const TOOL_SHORTCUT_BY_CODE: Record<string, ToolId> = toolShortcutMapFromSettings();

export function toolIdFromShortcutKey(
  event: {
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    isComposing?: boolean;
  },
  shortcuts: Pick<ShortcutMap, 'pen' | 'eraser' | 'text' | 'select' | 'lasso' | 'scissors'> = DEFAULT_SHORTCUTS,
): ToolId | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
    return null;
  }
  return toolShortcutMapFromSettings(shortcuts)[event.code] ?? null;
}

export function nextPenEraserTool(current: ToolId): ToolId {
  return current === 'eraser' ? 'pen' : 'eraser';
}

/** W3C stylus eraser / barrel / aux (Safari 18.2 auxclick). */
export function isStylusBarrelToggle(
  event: Pick<PointerEvent, 'pointerType' | 'button' | 'buttons'>,
): boolean {
  if (event.pointerType !== 'pen' && event.pointerType !== 'eraser') {
    return false;
  }
  if (event.pointerType === 'eraser') {
    return true;
  }
  return event.button === 5 || event.button === 2 || (event.buttons & 32) !== 0 || (event.buttons & 4) !== 0;
}

export function bindToolShortcuts(
  onTool: (tool: ToolId) => void,
  target: Window = window,
  shortcuts: Pick<ShortcutMap, 'pen' | 'eraser' | 'text' | 'select' | 'lasso' | 'scissors'> = DEFAULT_SHORTCUTS,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget()) {
      return;
    }
    const tool = toolIdFromShortcutKey(event, shortcuts);
    if (!tool) {
      return;
    }
    event.preventDefault();
    onTool(tool);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * Toggle pen/eraser from stylus barrel, eraser end, or Safari auxclick.
 * Apple Pencil side double-tap is not a documented Web API; we listen for every
 * pen non-primary button / auxclick / contextmenu the OS may map to it.
 */
export function bindStylusPenEraserToggle(
  getTool: () => ToolId,
  onTool: (tool: ToolId) => void,
  target: Window = window,
): () => void {
  let lastToggleAt = 0;
  const toggle = () => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastToggleAt < 280) {
      return;
    }
    lastToggleAt = now;
    onTool(nextPenEraserTool(getTool()));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (isTypingTarget()) {
      return;
    }
    if (isStylusBarrelToggle(event)) {
      event.preventDefault();
      toggle();
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (isTypingTarget()) {
      return;
    }
    if (isStylusBarrelToggle(event)) {
      event.preventDefault();
      toggle();
    }
  };
  const onAuxClick = (event: MouseEvent) => {
    if (isTypingTarget()) {
      return;
    }
    const pointerType = 'pointerType' in event ? String((event as PointerEvent).pointerType) : '';
    if (pointerType !== 'pen' && pointerType !== 'eraser') {
      return;
    }
    event.preventDefault();
    toggle();
  };
  const onContextMenu = (event: MouseEvent) => {
    const pointerType = 'pointerType' in event ? String((event as PointerEvent).pointerType) : '';
    if (pointerType !== 'pen' && pointerType !== 'eraser') {
      return;
    }
    event.preventDefault();
    if (!isTypingTarget()) {
      toggle();
    }
  };

  const opts: AddEventListenerOptions = { capture: true };
  target.addEventListener('pointerdown', onPointerDown, opts);
  target.addEventListener('pointerup', onPointerUp, opts);
  target.addEventListener('auxclick', onAuxClick, opts);
  target.addEventListener('contextmenu', onContextMenu, opts);
  return () => {
    target.removeEventListener('pointerdown', onPointerDown, opts);
    target.removeEventListener('pointerup', onPointerUp, opts);
    target.removeEventListener('auxclick', onAuxClick, opts);
    target.removeEventListener('contextmenu', onContextMenu, opts);
  };
}
