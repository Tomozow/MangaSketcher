import { describe, expect, test } from 'vitest';

import { historyActionFromShortcutKey } from '../historyShortcuts';

const bare = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

describe('historyShortcuts', () => {
  test('W / S undo and redo without modifiers', () => {
    expect(historyActionFromShortcutKey({ code: 'KeyW', ...bare })).toBe('undo');
    expect(historyActionFromShortcutKey({ code: 'KeyS', ...bare })).toBe('redo');
  });

  test('uses remapped undo and redo keys, Ctrl+Z/Y stay', () => {
    const shortcuts = { undo: 'KeyQ', redo: 'KeyR' };
    expect(historyActionFromShortcutKey({ code: 'KeyQ', ...bare }, shortcuts)).toBe('undo');
    expect(historyActionFromShortcutKey({ code: 'KeyR', ...bare }, shortcuts)).toBe('redo');
    expect(historyActionFromShortcutKey({ code: 'KeyW', ...bare }, shortcuts)).toBeNull();
    expect(historyActionFromShortcutKey({ code: 'KeyZ', ...bare, ctrlKey: true }, shortcuts)).toBe('undo');
  });

  test('Ctrl+Z and Ctrl+Y undo and redo', () => {
    expect(historyActionFromShortcutKey({ code: 'KeyZ', ...bare, ctrlKey: true })).toBe('undo');
    expect(historyActionFromShortcutKey({ code: 'KeyY', ...bare, ctrlKey: true })).toBe('redo');
  });

  test('Meta+Z and Meta+Y match Ctrl', () => {
    expect(historyActionFromShortcutKey({ code: 'KeyZ', ...bare, metaKey: true })).toBe('undo');
    expect(historyActionFromShortcutKey({ code: 'KeyY', ...bare, metaKey: true })).toBe('redo');
  });

  test('ignores IME, Alt, Shift, and unrelated keys', () => {
    expect(historyActionFromShortcutKey({ code: 'KeyW', ...bare, isComposing: true })).toBeNull();
    expect(historyActionFromShortcutKey({ code: 'KeyW', ...bare, altKey: true })).toBeNull();
    expect(historyActionFromShortcutKey({ code: 'KeyZ', ...bare, ctrlKey: true, shiftKey: true })).toBeNull();
    expect(historyActionFromShortcutKey({ code: 'KeyB', ...bare })).toBeNull();
    expect(historyActionFromShortcutKey({ code: 'KeyW', ...bare, ctrlKey: true })).toBeNull();
  });
});
