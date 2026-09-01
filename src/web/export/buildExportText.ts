import { isTextContentEmpty } from '../../domain/text';
import type { EditorDocument, PageText } from '../../domain/types';
import { padPageIndex } from './constants';
import { sortPageTexts } from './sortPageTexts';

export function flattenTextContentLine(content: string): string {
  return content.replace(/\r\n/g, ' ').replace(/\r/g, ' ').replace(/\n/g, ' ');
}

export function buildExportText(
  doc: Pick<EditorDocument, 'workspaceOrder' | 'pages'>,
  pageIds: readonly string[] = doc.workspaceOrder,
): string {
  if (pageIds.length === 0) {
    return '';
  }
  const blocks = pageIds.map((pageId) => {
    const page = doc.pages[pageId];
    const workspaceNumber = doc.workspaceOrder.indexOf(pageId) + 1;
    const heading = `=== ${padPageIndex(workspaceNumber > 0 ? workspaceNumber : 1)} ===`;
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
