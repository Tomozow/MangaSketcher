import { describe, expect, test } from 'vitest';

import { isStylusBarrelToggle, nextPenEraserTool, toolIdFromShortcutKey } from '../toolShortcuts';

describe('toolShortcuts', () => {
  test('B/E/T/C map to pen/eraser/text/select', () => {
    expect(toolIdFromShortcutKey({ code: 'KeyB', ctrlKey: false, metaKey: false, altKey: false })).toBe('pen');
    expect(toolIdFromShortcutKey({ code: 'KeyE', ctrlKey: false, metaKey: false, altKey: false })).toBe('eraser');
    expect(toolIdFromShortcutKey({ code: 'KeyT', ctrlKey: false, metaKey: false, altKey: false })).toBe('text');
    expect(toolIdFromShortcutKey({ code: 'KeyC', ctrlKey: false, metaKey: false, altKey: false })).toBe('select');
  });

  test('uses remapped shortcut codes', () => {
    const shortcuts = { pen: 'KeyQ', eraser: 'KeyW', text: 'KeyR', select: 'KeyF', undo: 'KeyZ', redo: 'KeyX' };
    expect(toolIdFromShortcutKey({ code: 'KeyQ', ctrlKey: false, metaKey: false, altKey: false }, shortcuts)).toBe(
      'pen',
    );
    expect(toolIdFromShortcutKey({ code: 'KeyB', ctrlKey: false, metaKey: false, altKey: false }, shortcuts)).toBeNull();
  });

  test('ignores modifiers, IME composing, and other keys', () => {
    expect(toolIdFromShortcutKey({ code: 'KeyB', ctrlKey: true, metaKey: false, altKey: false })).toBeNull();
    expect(toolIdFromShortcutKey({ code: 'KeyC', ctrlKey: false, metaKey: true, altKey: false })).toBeNull();
    expect(toolIdFromShortcutKey({ code: 'KeyT', ctrlKey: false, metaKey: false, altKey: true })).toBeNull();
    expect(
      toolIdFromShortcutKey({ code: 'KeyE', ctrlKey: false, metaKey: false, altKey: false, isComposing: true }),
    ).toBeNull();
    expect(toolIdFromShortcutKey({ code: 'KeyA', ctrlKey: false, metaKey: false, altKey: false })).toBeNull();
  });

  test('nextPenEraserTool toggles pen and eraser', () => {
    expect(nextPenEraserTool('pen')).toBe('eraser');
    expect(nextPenEraserTool('eraser')).toBe('pen');
    expect(nextPenEraserTool('text')).toBe('eraser');
  });

  test('isStylusBarrelToggle is pen eraser button only', () => {
    expect(isStylusBarrelToggle({ pointerType: 'pen', button: 5, buttons: 32 })).toBe(true);
    expect(isStylusBarrelToggle({ pointerType: 'pen', button: 2, buttons: 4 })).toBe(true);
    expect(isStylusBarrelToggle({ pointerType: 'eraser', button: 0, buttons: 0 })).toBe(true);
    expect(isStylusBarrelToggle({ pointerType: 'mouse', button: 5, buttons: 32 })).toBe(false);
  });
});
