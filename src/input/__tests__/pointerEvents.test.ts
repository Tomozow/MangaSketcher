import { describe, expect, test } from 'vitest';
import {
  createPointerKindTracker,
  createPressureState,
  isPencilHover,
  markPointerDown,
  markPointerUp,
  pointerKindForWorkspace,
  pointerKindFromWeb,
  pressureFromWeb,
} from '../pointerEvents';
import { workspacePointerPolicy } from '../../domain/pointers';

describe('pointerEvents (Web)', () => {
  test('pointerType: pen→pencil, touch→finger, mouse→finger', () => {
    expect(pointerKindFromWeb({ pointerType: 'pen' } as PointerEvent)).toBe('pencil');
    expect(pointerKindFromWeb({ pointerType: 'touch' } as PointerEvent)).toBe('finger');
    expect(pointerKindFromWeb({ pointerType: 'mouse' } as PointerEvent)).toBe('finger');
  });

  test('workspace mouse: left button is pencil; Space pan stays finger', () => {
    const mouse = { pointerType: 'mouse', button: 0, buttons: 1 } as PointerEvent;
    expect(pointerKindForWorkspace(mouse, 'down', 'none')).toBe('pencil');
    expect(pointerKindForWorkspace(mouse, 'move', 'none')).toBe('pencil');
    expect(pointerKindForWorkspace({ ...mouse, buttons: 0 } as PointerEvent, 'up', 'none')).toBe('pencil');
    expect(pointerKindForWorkspace({ pointerType: 'mouse', button: 0, buttons: 0 } as PointerEvent, 'move', 'none')).toBe(
      'finger',
    );
    expect(pointerKindForWorkspace(mouse, 'down', 'pan')).toBe('finger');
    expect(pointerKindForWorkspace({ pointerType: 'mouse', button: 2, buttons: 0 } as PointerEvent, 'down', 'none')).toBe(
      'finger',
    );
    expect(pointerKindForWorkspace({ pointerType: 'mouse', button: 2, buttons: 0 } as PointerEvent, 'up', 'none')).toBe(
      'finger',
    );
    expect(pointerKindForWorkspace({ pointerType: '', button: 0, buttons: 1 } as PointerEvent, 'down', 'pan')).toBe(
      'finger',
    );
  });

  test('sticky は最初の判定を維持し Pencil に昇格しない', () => {
    const tracker = createPointerKindTracker();
    expect(tracker.classify({ pointerId: 1, pointerType: 'touch' } as PointerEvent)).toBe('finger');
    expect(tracker.classify({ pointerId: 1, pointerType: 'pen' } as PointerEvent)).toBe('finger');
    tracker.release({ pointerId: 1 } as PointerEvent);
    expect(tracker.classify({ pointerId: 1, pointerType: 'pen' } as PointerEvent)).toBe('pencil');
  });

  test('筆圧: 接触中の 0 は直前値、初回は 0.5、>1 は 1', () => {
    const state = createPressureState();
    markPointerDown(state);
    expect(pressureFromWeb({ pressure: 0, buttons: 1 } as PointerEvent, state)).toBe(0.5);
    expect(pressureFromWeb({ pressure: 0.8, buttons: 1 } as PointerEvent, state)).toBe(0.8);
    expect(pressureFromWeb({ pressure: 0, buttons: 1 } as PointerEvent, state)).toBe(0.8);
    expect(pressureFromWeb({ pressure: 1.4, buttons: 1 } as PointerEvent, state)).toBe(1);
    markPointerUp(state);
    expect(pressureFromWeb({ pressure: 0.2, buttons: 0 } as PointerEvent, state)).toBe(1);
  });

  test('Pencil hover (buttons===0) は無視対象', () => {
    expect(isPencilHover({ buttons: 0, pressure: 0.5 } as PointerEvent, 'pencil')).toBe(true);
    expect(isPencilHover({ buttons: 1, pressure: 0.5 } as PointerEvent, 'pencil')).toBe(false);
    expect(isPencilHover({ buttons: 0, pressure: 0.5 } as PointerEvent, 'finger')).toBe(false);
  });

  test('ワークスペースポリシーは domain/pointers から import', () => {
    expect(workspacePointerPolicy('pencil').grabPage).toBe(false);
    expect(workspacePointerPolicy('finger').pan).toBe(true);
  });
});
