export type DesktopNavMode = 'none' | 'pan' | 'zoom';

let spaceDown = false;
let ctrlDown = false;

function isTypingTarget(): boolean {
  const el = document.activeElement;
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
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

export function resetDesktopNavKeys(): void {
  spaceDown = false;
  ctrlDown = false;
}

/** Space = pan, Ctrl+Space = zoom (PC workspace navigation). */
export function bindDesktopNavKeys(target: Window = window): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
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

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space' || event.key === ' ') {
      spaceDown = false;
    }
    if (!event.ctrlKey) {
      ctrlDown = false;
    }
  };

  const onBlur = () => {
    resetDesktopNavKeys();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('blur', onBlur);
    resetDesktopNavKeys();
  };
}

/** Test helper */
export function setDesktopNavKeysForTest(space: boolean, ctrl: boolean): void {
  spaceDown = space;
  ctrlDown = ctrl;
}
