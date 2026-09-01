export type DesktopNavMode = 'none' | 'pan' | 'zoom';

let spaceDown = false;
let ctrlDown = false;
let bindCount = 0;
let bindTarget: Window | null = null;
let boundOnKeyDown: ((event: KeyboardEvent) => void) | null = null;
let boundOnKeyUp: ((event: KeyboardEvent) => void) | null = null;
let boundOnBlur: (() => void) | null = null;

function isTypingTarget(): boolean {
  const el = document.activeElement;
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

export { isTypingTarget };

/** Pen/touch are not desktop mouse nav. Empty pointerType is treated as mouse (some Windows Chrome). */
export function isDesktopMousePointer(pointerType?: string): boolean {
  return pointerType !== 'pen' && pointerType !== 'touch';
}

export function desktopNavMode(): DesktopNavMode {
  if (!spaceDown) {
    return 'none';
  }
  if (ctrlDown) {
    return 'zoom';
  }
  return 'pan';
}

/** Space / Ctrl+Space, or right mouse button (pan). */
export function desktopNavForPointer(
  event: Pick<PointerEvent, 'pointerType' | 'button' | 'buttons'>,
  phase: 'down' | 'move' | 'up' | 'cancel',
): DesktopNavMode {
  if (!isDesktopMousePointer(event.pointerType)) {
    return 'none';
  }
  const keyNav = desktopNavMode();
  if (keyNav !== 'none') {
    return keyNav;
  }
  if (phase === 'down' && event.button === 2) {
    return 'pan';
  }
  if (phase === 'move' && (event.buttons & 2) !== 0) {
    return 'pan';
  }
  if ((phase === 'up' || phase === 'cancel') && event.button === 2) {
    return 'pan';
  }
  return 'none';
}

export function resetDesktopNavKeys(): void {
  spaceDown = false;
  ctrlDown = false;
}

/** Space = pan, Ctrl+Space = zoom (PC workspace navigation). */
export function bindDesktopNavKeys(target: Window = window): () => void {
  if (bindCount === 0) {
    bindTarget = target;
    boundOnKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        if (!isTypingTarget()) {
          event.preventDefault();
        }
        spaceDown = true;
      }
      if (event.ctrlKey) {
        ctrlDown = true;
      }
    };
    boundOnKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        spaceDown = false;
      }
      if (!event.ctrlKey) {
        ctrlDown = false;
      }
    };
    boundOnBlur = () => {
      resetDesktopNavKeys();
    };
    target.addEventListener('keydown', boundOnKeyDown);
    target.addEventListener('keyup', boundOnKeyUp);
    target.addEventListener('blur', boundOnBlur);
  }
  bindCount += 1;
  return () => {
    bindCount = Math.max(0, bindCount - 1);
    if (bindCount > 0 || !bindTarget || !boundOnKeyDown || !boundOnKeyUp || !boundOnBlur) {
      return;
    }
    bindTarget.removeEventListener('keydown', boundOnKeyDown);
    bindTarget.removeEventListener('keyup', boundOnKeyUp);
    bindTarget.removeEventListener('blur', boundOnBlur);
    bindTarget = null;
    boundOnKeyDown = null;
    boundOnKeyUp = null;
    boundOnBlur = null;
    resetDesktopNavKeys();
  };
}

/** Test helper */
export function setDesktopNavKeysForTest(space: boolean, ctrl: boolean): void {
  spaceDown = space;
  ctrlDown = ctrl;
}
