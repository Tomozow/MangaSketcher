'use client';

import { buildStripFrames, PAGE_DISPLAY_H } from '@/src/domain/stripGeometry';
import type { PageId, PageText } from '@/src/domain/types';
import type { EditorDocument } from '@/src/storage/types';
import styles from '@/src/web/editor.module.css';

type PageTextOverlayProps = {
  doc: EditorDocument;
  hidden: boolean;
};

function pageTextsForFrame(
  framePageId: PageId | undefined,
  pages: EditorDocument['pages'],
): PageText[] {
  if (!framePageId) {
    return [];
  }
  return pages[framePageId]?.texts ?? [];
}

export function PageTextOverlay({ doc, hidden }: PageTextOverlayProps) {
  const { frames } = buildStripFrames(doc.workspaceOrder);

  return (
    <div
      className={`${styles.pageTextOverlay} ${hidden ? styles.pageTextOverlayHidden : ''}`}
      aria-hidden={hidden}
    >
      <div
        className={styles.pageTextTransform}
        style={{
          transform: `translate(${doc.workspacePanX}px, ${doc.workspacePanY}px) scale(${doc.workspaceZoom})`,
          width: 'max-content',
          height: 'max-content',
        }}
      >
        {frames.map((frame) => {
          if (frame.slot.kind !== 'page') {
            return null;
          }
          const { pageId } = frame.slot;
          const texts = pageTextsForFrame(pageId, doc.pages);
          const scaleX = frame.width / doc.rasterWidth;
          const scaleY = frame.height / doc.rasterHeight;

          return texts.map((text) => {
            const selected = doc.selectedTextId === text.id;
            return (
              <div
                key={text.id}
                className={`${styles.pageTextBox} ${selected ? styles.pageTextBoxSelected : ''}`}
                style={{
                  left: frame.x + text.box.x * scaleX,
                  top: frame.y + text.box.y * scaleY,
                  width: text.box.width * scaleX,
                  height: text.box.height * scaleY,
                  color: text.color,
                  fontSize: text.fontSize * scaleX,
                  lineHeight: 1.2,
                }}
              >
                {text.content}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

export { PAGE_DISPLAY_H };
