import { describe, expect, test } from 'vitest';
import { createEditorDocument, sequentialIds } from '../../../domain/document';
import type { PageText } from '../../../domain/types';
import { buildExportText, flattenTextContentLine } from '../buildExportText';

function pageText(id: string, content: string, box: PageText['box']): PageText {
  return { id, content, box, fontSize: 12, color: '#000' };
}

describe('flattenTextContentLine', () => {
  test('CRLF then leftover CR/LF become spaces and consecutive spaces are kept', () => {
    expect(flattenTextContentLine('a\r\nb\nc\rd')).toBe('a b c d');
    expect(flattenTextContentLine('a\n\nb')).toBe('a  b');
  });
});

describe('buildExportText', () => {
  test('empty workspace is 0 bytes', () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    doc.workspaceOrder = [];
    expect(buildExportText(doc)).toBe('');
  });

  test('empty page still has heading; empty content omitted; trailing LF', () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 3,
      ids: sequentialIds('pg'),
    });
    const [a, b, c] = doc.workspaceOrder;
    doc.pages[a!]!.texts = [
      pageText('t1', 'セリフ1', { x: 900, y: 100, width: 80, height: 400 }),
      pageText('t2', 'セリフ2', { x: 700, y: 50, width: 80, height: 400 }),
    ];
    doc.pages[b!]!.texts = [pageText('empty', '   ', { x: 10, y: 10, width: 10, height: 10 })];
    doc.pages[c!]!.texts = [
      pageText('t3', 'セリフ3', { x: 100, y: 100, width: 80, height: 400 }),
    ];
    expect(buildExportText(doc)).toBe(
      ['=== 001 ===', 'セリフ1', 'セリフ2', '', '=== 002 ===', '', '=== 003 ===', 'セリフ3', ''].join(
        '\n',
      ),
    );
  });

  test('content newlines become spaces on one line', () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 1,
      ids: sequentialIds('pg'),
    });
    const pageId = doc.workspaceOrder[0]!;
    doc.pages[pageId]!.texts = [
      pageText('t', '上\r\n下', { x: 10, y: 10, width: 10, height: 10 }),
    ];
    expect(buildExportText(doc)).toBe('=== 001 ===\n上 下\n');
  });

  test('subset uses workspace numbers in headings', () => {
    const doc = createEditorDocument({
      projectId: 'p',
      name: 'n',
      pageCount: 3,
      ids: sequentialIds('pg'),
    });
    const [, b, c] = doc.workspaceOrder;
    expect(buildExportText(doc, [b!, c!]).startsWith('=== 002 ===')).toBe(true);
  });
});
