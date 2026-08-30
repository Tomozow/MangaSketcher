import { isTypingTarget } from './desktopNavKeys';

export type HistoryShortcutAction = 'undo' | 'redo';

export function historyActionFromShortcutKey(event: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}): HistoryShortcutAction | null {
  if (event.altKey || event.isComposing) {
    return null;
  }
  const mod = event.ctrlKey || event.metaKey;
  if (mod) {
    if (event.shiftKey) {
      return null;
    }
    if (event.code === 'KeyZ') {
      return 'undo';
    }
    if (event.code === 'KeyY') {
      return 'redo';
    }
    return null;
  }
  if (event.shiftKey) {
    return null;
  }
  if (event.code === 'KeyW') {
    return 'undo';
  }
  if (event.code === 'KeyS') {
    return 'redo';
  }
  return null;
}

export function bindHistoryShortcuts(
  handlers: { onUndo: () => void; onRedo: () => void },
  target: Window = window,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget()) {
      return;
    }
    const action = historyActionFromShortcutKey(event);
    if (!action) {
      return;
    }
    event.preventDefault();
    if (action === 'undo') {
      handlers.onUndo();
    } else {
      handlers.onRedo();
    }
  };
  target.addEventListener('keydown', onKeyDown);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
  };
}
