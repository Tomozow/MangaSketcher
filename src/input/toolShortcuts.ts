import type { ToolId } from '../domain/types';
import { isTypingTarget } from './desktopNavKeys';

export const TOOL_SHORTCUT_BY_CODE: Record<string, ToolId> = {
  KeyB: 'pen',
  KeyE: 'eraser',
  KeyT: 'text',
  KeyC: 'select',
};

export function toolIdFromShortcutKey(event: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}): ToolId | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
    return null;
  }
  return TOOL_SHORTCUT_BY_CODE[event.code] ?? null;
}

export function bindToolShortcuts(onTool: (tool: ToolId) => void, target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget()) {
      return;
    }
    const tool = toolIdFromShortcutKey(event);
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
