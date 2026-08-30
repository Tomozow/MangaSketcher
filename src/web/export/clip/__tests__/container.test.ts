import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseClip, rebuildClip } from '../container';

const SAMPLE_CLIP = join(process.cwd(), 'sample', 'export_sample.clip');

describe('clip container', () => {
  test('parse → rebuild without SQLite change yields byte-identical output', () => {
    const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
    const parsed = parseClip(original);
    const rebuilt = rebuildClip(parsed);

    expect(rebuilt.length).toBe(original.length);
    expect(rebuilt).toEqual(original);
  });
});
