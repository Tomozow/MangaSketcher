'use client';

import { useEffect } from 'react';

export function DisableContextMenu() {
  useEffect(() => {
    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  return null;
}
