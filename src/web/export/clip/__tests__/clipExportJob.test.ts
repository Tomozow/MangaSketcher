import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Rect } from '../../../../domain/types';
import { ClipExportJob, type ClipExportJobDeps } from '../clipExportJob';
import type { ClipExportStartMessage, ClipWorkerResponse } from '../clipExportProtocol';
import { CSFCHUNK_MAGIC_BYTES, parseClip } from '../container';
import { CLIP_CANVAS_HEIGHT, CLIP_CANVAS_WIDTH } from '../exportConstants';

const TEMPLATE_PATH = join(process.cwd(), 'public', 'clip-export-template.clip');

let sql: SqlJsStatic;
let templateBytes: Uint8Array;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  sql = await initSqlJs({ locateFile: () => wasmPath });
  templateBytes = new Uint8Array(readFileSync(TEMPLATE_PATH));
});

const BOX: Rect = { x: 700, y: 100, width: 300, height: 400 };

function makeStart(overrides: Partial<ClipExportStartMessage> = {}): ClipExportStartMessage {
  return {
    type: 'start',
    mode: 'zip',
    rasterWidth: 1200,
    rasterHeight: 1700,
    folderName: 'proj_20260830-1200_clip',
    entryNames: ['001.clip', '002.clip'],
    pages: [
      { texts: [{ content: 'ページ一', box: { ...BOX }, fontSize: 36 }] },
      { texts: [{ content: 'ページ二', box: { ...BOX }, fontSize: 36 }] },
    ],
    ...overrides,
  };
}

function markerRgba(): Uint8Array {
  const rgba = new Uint8Array(CLIP_CANVAS_WIDTH * CLIP_CANVAS_HEIGHT * 4);
  const px = (50 * CLIP_CANVAS_WIDTH + 50) * 4;
  rgba[px + 3] = 255;
  return rgba;
}

/** Node-side deps: template from disk, fake PNG decode, scripted ink feed. */
function createJob(inkByIndex: (ArrayBuffer | null)[]): {
  job: ClipExportJob;
  posted: ClipWorkerResponse[];
  decoded: number[];
} {
  const posted: ClipWorkerResponse[] = [];
  const decoded: number[] = [];
  let jobRef: ClipExportJob | null = null;
  const deps: ClipExportJobDeps = {
    loadSql: async () => sql,
    loadTemplate: async () => templateBytes,
    decodeInkPng: async (png) => {
      decoded.push(png.byteLength);
      return markerRgba();
    },
    post: (message) => {
      posted.push(message);
      if (message.type === 'need-ink') {
        queueMicrotask(() => jobRef?.receiveInk(message.index, inkByIndex[message.index] ?? null));
      }
    },
  };
  const job = new ClipExportJob(deps);
  jobRef = job;
  return { job, posted, decoded };
}

function startsWithMagic(bytes: Uint8Array): boolean {
  return CSFCHUNK_MAGIC_BYTES.every((b, i) => bytes[i] === b);
}

describe('ClipExportJob', () => {
  test('zip mode streams pages in order and emits a valid stored ZIP', async () => {
    const inkPng = new ArrayBuffer(16); // fake PNG; decodeInkPng is injected
    const { job, posted, decoded } = createJob([inkPng, null]);
    await job.run(makeStart());

    expect(posted.map((m) => m.type)).toEqual([
      'progress',
      'need-ink',
      'progress',
      'need-ink',
      'done',
    ]);
    expect(posted.filter((m) => m.type === 'progress')).toEqual([
      { type: 'progress', current: 1, total: 2 },
      { type: 'progress', current: 2, total: 2 },
    ]);
    // Only page 0 had ink bytes; page 1 must not hit the decoder.
    expect(decoded).toEqual([16]);

    const done = posted.at(-1);
    if (done?.type !== 'done') {
      throw new Error('missing done');
    }
    expect(done.blob.type).toBe('application/zip');
    const zipBytes = new Uint8Array(await done.blob.arrayBuffer());
    // Local file header: method (offset 8, LE u16) must be 0 = stored.
    expect(zipBytes[8]).toBe(0);
    expect(zipBytes[9]).toBe(0);

    const entries = unzipSync(zipBytes);
    expect(Object.keys(entries).sort()).toEqual([
      'proj_20260830-1200_clip/001.clip',
      'proj_20260830-1200_clip/002.clip',
    ]);

    for (const bytes of Object.values(entries)) {
      expect(startsWithMagic(bytes)).toBe(true);
      const parsed = parseClip(bytes);
      const db = new sql.Database(parsed.sqliteBytes);
      try {
        const count = db.exec(
          'SELECT COUNT(*) FROM Layer WHERE TextLayerString IS NOT NULL',
        )[0]!.values[0]![0];
        expect(count).toBe(1);
      } finally {
        db.close();
      }
    }
  });

  test('single mode returns the bare .clip blob', async () => {
    const { job, posted } = createJob([null]);
    await job.run(
      makeStart({
        mode: 'single',
        entryNames: ['proj_p001.clip'],
        pages: [{ texts: [{ content: 'ひとり', box: { ...BOX }, fontSize: 36 }] }],
      }),
    );

    const done = posted.at(-1);
    if (done?.type !== 'done') {
      throw new Error('missing done');
    }
    expect(done.blob.type).toBe('application/octet-stream');
    const bytes = new Uint8Array(await done.blob.arrayBuffer());
    expect(startsWithMagic(bytes)).toBe(true);
    expect(parseClip(bytes).extas.length).toBeGreaterThan(0);
  });

  test('posts error when the job input is inconsistent', async () => {
    const { job, posted } = createJob([]);
    await job.run(makeStart({ entryNames: ['only-one.clip'] }));
    const last = posted.at(-1);
    expect(last?.type).toBe('error');
  });
});
