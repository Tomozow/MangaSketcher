import { isTextContentEmpty } from '../../domain/text';
import type { EditorDocument, PageText } from '../../domain/types';
import { padPageIndex } from './constants';
import { sortPageTexts } from './sortPageTexts';

export function flattenTextContentLine(content: string): string {
  return content.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');
}

export function buildExportText(doc: Pick<EditorDocument, 'workspaceOrder' | 'pages'>): string {
  if (doc.workspaceOrder.length === 0) {
    return '';
  }
  const blocks = doc.workspaceOrder.map((pageId, index) => {
    const page = doc.pages[pageId];
    const heading = `=== ${padPageIndex(index + 1)} ===`;
    if (!page) {
      return heading;
    }
    const lines = textLinesForPage(page.texts);
    return lines.length === 0 ? heading : `${heading}\n${lines.join('\n')}`;
  });
  return `${blocks.join('\n\n')}\n`;
}

function textLinesForPage(texts: readonly PageText[]): string[] {
  const lines: string[] = [];
  for (const text of sortPageTexts(texts)) {
    if (isTextContentEmpty(text.content)) {
      continue;
    }
    lines.push(flattenTextContentLine(text.content));
  }
  return lines;
}
