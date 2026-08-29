'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import { PAGE_DELETE_CHROME_ATTR } from '@/src/web/gestures/pageTextDom';
import { styles } from './editorStyles';

type PageChromeButtonsProps = {
  onInsert?: () => void;
  onDelete?: () => void;
};

function stopPointer(event: ReactPointerEvent) {
  event.stopPropagation();
}

export function PageChromeButtons({ onInsert, onDelete }: PageChromeButtonsProps) {
  if (!onInsert && !onDelete) {
    return null;
  }
  return (
    <div
      className={styles.pageChromeRow}
      {...{ [PAGE_DELETE_CHROME_ATTR]: '' }}
      onPointerDown={stopPointer}
    >
      {onInsert ? (
        <button
          type="button"
          className={styles.pageDeleteButton}
          aria-label="ページを挿入"
          onClick={(event) => {
            event.stopPropagation();
            onInsert();
          }}
        >
          挿入
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className={styles.pageDeleteButton}
          aria-label="ページを削除"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          削除
        </button>
      ) : null}
    </div>
  );
}
