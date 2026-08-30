/**
 * Benchmark for src/web/export/clip/raster.ts encode/decode.
 *
 * Usage:
 *   npx tsx tools/clip-experiments/bench_raster.ts             # encode/decode bench (all patterns)
 *   npx tsx tools/clip-experiments/bench_raster.ts --runs 5    # more timed runs
 *   npx tsx tools/clip-experiments/bench_raster.ts --phases    # naive-pipeline phase attribution
 *   npx tsx tools/clip-experiments/bench_raster.ts --zlib-sweep # fflate level/mem sweep on real tiles
 *   npx tsx tools/clip-experiments/bench_raster.ts --make-e5 [name.clip]
 *       # build an E5-equivalent clip with the CURRENT encoder into sample/_experiments/<name>
 *       # (default: E5_bench_check.clip) for: python tools/clip-experiments/validate_raster.py <path>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { zlibSync } from 'fflate';
import {
  TILE,
  adler32,
  decodeColorOffscreen,
  encodeColorOffscreen,
  generateE5TestImage,
  gridFor,
  rebuildAttribute,
} from '../../src/web/export/clip/raster';
import { parseClip, rebuildClip } from '../../src/web/export/clip/container';
import {
  getOffscreenExternalId,
  readOffscreenAttribute,
  rebuildExternalChunk,
  replaceExtaBody,
  writeOffscreenAttribute,
} from './dbHelpers';
import { exportDatabase, openDatabase } from './sqlJsInit';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE_CLIP = join(ROOT, 'sample', 'export_sample.clip');
const OUT_DIR = join(ROOT, 'sample', '_experiments');

const WIDTH = 1518;
const HEIGHT = 2150;
const LINEART_OFFSCREEN_ID = 48;

// ---------------------------------------------------------------------------
// Test patterns (1518x2150 RGBA)
// ---------------------------------------------------------------------------

/** White opaque background + sparse black strokes (typical manga lineart page). */
function makeLineart(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4).fill(255);

  const stroke = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    rgba[i] = 0;
    rgba[i + 1] = 0;
    rgba[i + 2] = 0;
    // alpha stays 255
  };

  const line = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      for (let dy = -t; dy <= t; dy++) {
        for (let dx = -t; dx <= t; dx++) {
          if (dx * dx + dy * dy <= t * t) stroke(x + dx, y + dy);
        }
      }
    }
  };

  // panel borders
  line(40, 40, width - 40, 40, 2);
  line(40, height - 40, width - 40, height - 40, 2);
  line(40, 40, 40, height - 40, 2);
  line(width - 40, 40, width - 40, height - 40, 2);
  line(40, Math.floor(height * 0.45), width - 40, Math.floor(height * 0.45), 2);
  line(Math.floor(width * 0.55), 40, Math.floor(width * 0.55), Math.floor(height * 0.45), 2);
  // diagonals / "speed lines"
  for (let k = 0; k < 24; k++) {
    const x0 = Math.floor((width * k) / 24);
    line(x0, Math.floor(height * 0.5), Math.floor(width * 0.5), height - 60, 1);
  }
  // a few circles (outline)
  for (const [cx, cy, r] of [
    [width * 0.3, height * 0.22, 130],
    [width * 0.75, height * 0.7, 180],
  ] as const) {
    const steps = Math.ceil(2 * Math.PI * r);
    for (let s = 0; s < steps; s++) {
      const a = (2 * Math.PI * s) / steps;
      const x = Math.round(cx + r * Math.cos(a));
      const y = Math.round(cy + r * Math.sin(a));
      stroke(x, y);
      stroke(x + 1, y);
    }
  }
  return rgba;
}

/** Fully transparent page (all zero bytes). */
function makeTransparent(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

/** Pseudo-random noise (worst case for zlib). Deterministic xorshift32. */
function makeNoise(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  let s = 0x9e3779b9;
  for (let i = 0; i < rgba.length; i += 4) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    rgba[i] = s & 0xff;
    rgba[i + 1] = (s >>> 8) & 0xff;
    rgba[i + 2] = (s >>> 16) & 0xff;
    rgba[i + 3] = 255;
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// Bench helpers
// ---------------------------------------------------------------------------

interface BenchStat {
  min: number;
  median: number;
  mean: number;
  runs: number[];
}

function bench(fn: () => void, runs: number, warmup = 1): BenchStat {
  for (let i = 0; i < warmup; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    min: sorted[0]!,
    median: sorted[Math.floor(sorted.length / 2)]!,
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    runs: times,
  };
}

function fmt(ms: number): string {
  return ms >= 100 ? ms.toFixed(0) : ms.toFixed(1);
}

// ---------------------------------------------------------------------------
// Naive-pipeline phase attribution (standalone copy of the ORIGINAL algorithm,
// kept here so phase costs stay measurable after raster.ts is optimized)
// ---------------------------------------------------------------------------

function naiveAdler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function naiveTileRaw(padded: Uint8Array, paddedW: number, tx: number, ty: number): Uint8Array {
  const n = TILE * TILE;
  const raw = new Uint8Array(n * 5);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const px = tx * TILE + x;
      const py = ty * TILE + y;
      const srcOff = (py * paddedW + px) * 4;
      const a = padded[srcOff + 3]!;
      raw[y * TILE + x] = a;
      const bgrOff = n + (y * TILE + x) * 4;
      raw[bgrOff] = padded[srcOff + 2]!;
      raw[bgrOff + 1] = padded[srcOff + 1]!;
      raw[bgrOff + 2] = padded[srcOff]!;
      raw[bgrOff + 3] = 0;
    }
  }
  return raw;
}

function runPhases(label: string, rgba: Uint8Array): void {
  const { paddedW, paddedH, gridW, gridH } = gridFor(WIDTH, HEIGHT);

  let t0 = performance.now();
  const padded = new Uint8Array(paddedW * paddedH * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const srcOff = (y * WIDTH + x) * 4;
      const dstOff = (y * paddedW + x) * 4;
      padded[dstOff] = rgba[srcOff]!;
      padded[dstOff + 1] = rgba[srcOff + 1]!;
      padded[dstOff + 2] = rgba[srcOff + 2]!;
      padded[dstOff + 3] = rgba[srcOff + 3]!;
    }
  }
  const tPad = performance.now() - t0;

  t0 = performance.now();
  const raws: Uint8Array[] = [];
  for (let ty = 0; ty < gridH; ty++) {
    for (let tx = 0; tx < gridW; tx++) {
      raws.push(naiveTileRaw(padded, paddedW, tx, ty));
    }
  }
  const tExtract = performance.now() - t0;

  t0 = performance.now();
  const zs = raws.map((raw) => zlibSync(raw, { level: 1 }));
  const tZlib = performance.now() - t0;

  t0 = performance.now();
  for (const z of zs) {
    const buf = new Uint8Array(4 + z.length);
    new DataView(buf.buffer).setUint32(0, z.length, true);
    buf.set(z, 4);
    naiveAdler32(buf);
  }
  const tAdler = performance.now() - t0;

  const zTotal = zs.reduce((a, z) => a + z.length, 0);
  console.log(
    `  [${label}] pad=${fmt(tPad)}ms extract=${fmt(tExtract)}ms zlib=${fmt(tZlib)}ms ` +
      `adler(naive)=${fmt(tAdler)}ms  (compressed total ${(zTotal / 1024).toFixed(0)} KiB)`,
  );
}

// ---------------------------------------------------------------------------
// fflate parameter sweep on real tile raws
// ---------------------------------------------------------------------------

function runZlibSweep(rgba: Uint8Array): void {
  const { paddedW, gridW, gridH } = gridFor(WIDTH, HEIGHT);
  const padded = new Uint8Array(paddedW * gridFor(WIDTH, HEIGHT).paddedH * 4);
  for (let y = 0; y < HEIGHT; y++) {
    padded.set(rgba.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4), y * paddedW * 4);
  }
  const raws: Uint8Array[] = [];
  for (let ty = 0; ty < gridH; ty++) {
    for (let tx = 0; tx < gridW; tx++) {
      raws.push(naiveTileRaw(padded, paddedW, tx, ty));
    }
  }

  for (const level of [1, 2, 3] as const) {
    for (const mem of [4, 8, 12] as const) {
      const stat = bench(
        () => {
          for (const raw of raws) zlibSync(raw, { level, mem });
        },
        3,
        1,
      );
      const size = raws.reduce((a, raw) => a + zlibSync(raw, { level, mem }).length, 0);
      console.log(
        `  level=${level} mem=${mem}: median=${fmt(stat.median)}ms  out=${(size / 1024).toFixed(0)} KiB`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// E5-equivalent clip generation (for validate_raster.py cross-check)
// ---------------------------------------------------------------------------

async function makeE5Clip(outName: string): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);

  const testRgba = generateE5TestImage(WIDTH, HEIGHT);
  const t0 = performance.now();
  const encoded = encodeColorOffscreen(testRgba, WIDTH, HEIGHT);
  console.log(`encodeColorOffscreen(E5 image): ${fmt(performance.now() - t0)}ms`);

  const db = await openDatabase(parsed.sqliteBytes);
  const oldAttr = readOffscreenAttribute(db, LINEART_OFFSCREEN_ID);
  if (!oldAttr) throw new Error(`Offscreen MainId=${LINEART_OFFSCREEN_ID} Attribute not found`);
  const externalId = getOffscreenExternalId(db, LINEART_OFFSCREEN_ID);
  if (!externalId) throw new Error(`Offscreen MainId=${LINEART_OFFSCREEN_ID} external id not found`);

  const newAttr = rebuildAttribute(
    oldAttr,
    WIDTH,
    HEIGHT,
    encoded.gridW,
    encoded.gridH,
    encoded.blockSizes,
  );
  writeOffscreenAttribute(db, LINEART_OFFSCREEN_ID, newAttr);

  const extas = replaceExtaBody(parsed.extas, externalId, encoded.blockDataBody);
  rebuildExternalChunk(db, extas);
  const sqliteBytes = exportDatabase(db);
  db.close();

  const rebuilt = rebuildClip({ ...parsed, extas }, sqliteBytes);
  const outPath = join(OUT_DIR, outName);
  writeFileSync(outPath, rebuilt);
  console.log(`wrote ${outPath} (${rebuilt.length} bytes)`);
  console.log(`validate: python tools/clip-experiments/validate_raster.py "${outPath}"`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runsIdx = argv.indexOf('--runs');
  const runs = runsIdx >= 0 ? Number(argv[runsIdx + 1] ?? 3) : 3;

  if (argv.includes('--make-e5')) {
    const i = argv.indexOf('--make-e5');
    const name = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : 'E5_bench_check.clip';
    await makeE5Clip(name);
    return;
  }

  console.log(`raster bench  ${WIDTH}x${HEIGHT}  node=${process.version}  runs=${runs} (+1 warmup)`);
  const grid = gridFor(WIDTH, HEIGHT);
  console.log(`grid ${grid.gridW}x${grid.gridH} = ${grid.gridW * grid.gridH} tiles of ${TILE}x${TILE}\n`);

  const patterns: [string, Uint8Array][] = [
    ['lineart(white+lines)', makeLineart(WIDTH, HEIGHT)],
    ['transparent(all-0)  ', makeTransparent(WIDTH, HEIGHT)],
    ['noise(random)       ', makeNoise(WIDTH, HEIGHT)],
    ['e5(shapes on alpha) ', generateE5TestImage(WIDTH, HEIGHT)],
  ];

  if (argv.includes('--phases')) {
    console.log('phase attribution of ORIGINAL (naive) pipeline:');
    for (const [label, rgba] of patterns) runPhases(label.trim(), rgba);
    console.log('');
    return;
  }

  if (argv.includes('--zlib-sweep')) {
    console.log('fflate zlibSync sweep on lineart tiles (54 tiles x 320KiB):');
    runZlibSweep(patterns[0]![1]!);
    console.log('');
    return;
  }

  console.log('encodeColorOffscreen:');
  const encodedByLabel = new Map<string, Uint8Array>();
  for (const [label, rgba] of patterns) {
    let out: ReturnType<typeof encodeColorOffscreen> | null = null;
    const stat = bench(() => {
      out = encodeColorOffscreen(rgba, WIDTH, HEIGHT);
    }, runs);
    const body = out!.blockDataBody;
    encodedByLabel.set(label, body);
    console.log(
      `  ${label}  min=${fmt(stat.min)}ms  median=${fmt(stat.median)}ms  mean=${fmt(stat.mean)}ms` +
        `  body=${(body.length / 1024).toFixed(0)} KiB`,
    );
  }

  console.log('\ndecodeColorOffscreen:');
  for (const [label] of patterns) {
    const body = encodedByLabel.get(label)!;
    const stat = bench(() => {
      decodeColorOffscreen(body, WIDTH, HEIGHT);
    }, runs);
    console.log(`  ${label}  min=${fmt(stat.min)}ms  median=${fmt(stat.median)}ms  mean=${fmt(stat.mean)}ms`);
  }

  // sanity: encode->decode round-trip on lineart
  const rt = decodeColorOffscreen(encodedByLabel.get(patterns[0]![0])!, WIDTH, HEIGHT);
  const src = patterns[0]![1]!;
  let diff = 0;
  for (let i = 0; i < src.length; i++) {
    if (rt[i] !== src[i]) diff++;
  }
  console.log(`\nround-trip check (lineart): ${diff === 0 ? 'OK' : `MISMATCH bytes=${diff}`}`);

  // keep adler32 export exercised so tree-shaking/regressions get caught here
  const chk = adler32(new Uint8Array([1, 2, 3]));
  if (chk !== 0x000d0007) {
    console.log(`adler32 self-check FAILED: got 0x${chk.toString(16)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
