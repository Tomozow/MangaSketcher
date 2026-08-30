import { describe, expect, test } from 'vitest';

import { toolIdFromShortcutKey } from '../toolShortcuts';

describe('toolShortcuts', () => {
  test('B/E/T/C map to pen/eraser/text/select', () => {
    expect(toolIdFromShortcutKey({ code: 'KeyB', ctrlKey: false, metaKey: false, altKey: false })).toBe('pen');
    expect(toolIdFromShortcutKey({ code: 'KeyE', ctrlKey: false, metaKey: false, altKey: false })).toBe('eraser');
    expect(toolIdFromShortcutKey({ code: 'KeyT', ctrlKey: false, metaKey: false, altKey: false })).toBe('text');
    expect(toolIdFromShortcutKey({ code: 'KeyC', ctrlKey: false, metaKey: false, altKey: false })).toBe('select');
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
});
