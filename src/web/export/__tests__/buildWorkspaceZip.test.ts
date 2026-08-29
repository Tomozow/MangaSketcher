import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, test } from 'vitest';
import { buildWorkspaceZip } from '../buildWorkspaceZip';
import { buildExportZipNames } from '../sanitizeExportName';

const PNG_STORE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

function zipLocalEntries(bytes: Uint8Array): { name: string; method: number; flags: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: { name: string; method: number; flags: number }[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) {
      break;
    }
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    entries.push({ name, method, flags });
    offset += 30 + nameLen + extraLen + compressedSize;
  }
  return entries;
}

describe('buildWorkspaceZip', () => {
  test('stores png as method 0 and text without BOM', () => {
    const names = buildExportZipNames('demo', '20260829-1522');
    const zip = buildWorkspaceZip({
      folderName: names.folderName,
      pages: [{ index: 1, png: PNG_STORE }],
      text: '=== 001 ===\n',
    });
    const unzipped = unzipSync(zip);
    expect(Object.keys(unzipped).sort()).toEqual([
      'demo_20260829-1522/001.png',
      'demo_20260829-1522/text.txt',
    ]);
    const textBytes = unzipped['demo_20260829-1522/text.txt']!;
    expect(textBytes[0]).not.toBe(0xef);
    expect(strFromU8(textBytes)).toBe('=== 001 ===\n');

    const locals = zipLocalEntries(zip);
    const pngEntry = locals.find((entry) => entry.name.endsWith('001.png'));
    expect(pngEntry?.method).toBe(0);
  });

  test('japanese workspace name is utf-8 in entry paths', () => {
    const names = buildExportZipNames('漫画', '20260829-1522');
    const zip = buildWorkspaceZip({
      folderName: names.folderName,
      pages: [{ index: 1, png: PNG_STORE }],
      text: '',
    });
    const unzipped = unzipSync(zip);
    const paths = Object.keys(unzipped);
    expect(paths.some((path) => path.startsWith('漫画_20260829-1522/'))).toBe(true);
    const locals = zipLocalEntries(zip);
    expect(locals.every((entry) => entry.name.includes('漫画'))).toBe(true);
    expect(locals.some((entry) => (entry.flags & 0x0800) !== 0)).toBe(true);
  });
});
