import { describe, expect, test } from 'vitest';
import { clipAssetUrl } from '../clipExportBrowser';

describe('clipAssetUrl', () => {
  test('resolves public assets against the page origin, not the worker script path', () => {
    expect(clipAssetUrl('/sql-wasm-browser.wasm', 'http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000/sql-wasm-browser.wasm',
    );
    expect(clipAssetUrl('/clip-export-template.clip', 'https://192.168.0.2:3443')).toBe(
      'https://192.168.0.2:3443/clip-export-template.clip',
    );
  });
});
