import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'sql.js';
import { parseClip, rebuildClip } from '../../src/web/export/clip/container';
import type { TextLayerTemplate } from '../../src/web/export/clip/layerOps';
import {
  cloneTextLayer,
  createIdAllocator,
  deleteTextLayer,
  exportTextLayerTemplate,
  pickTextLayerTemplate,
  setCanvasCurrentLayer,
  setLayerSelect,
  stripTextLayerFloatCache,
} from '../../src/web/export/clip/layerOps';
import { textLayerPrototypeMainId } from '../../src/web/export/clip/textTlv';
import { rebuildExternalChunk } from '../clip-experiments/dbHelpers';
import { exportDatabase, openDatabase } from '../clip-experiments/sqlJsInit';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  LINEART_LAYER_ID,
  LINEART_OFFSCREEN_ID,
  PAGE_TEMPLATE_LAYER_ID,
  PAGE_TEMPLATE_OFFSCREEN_ID,
  TEXT_FOLDER_ID,
  chunkSizeBreakdown,
  decodeOffscreenRgba,
  pageNumberPixelRect,
  paintWhiteRect,
  removeLayerThumbnailExta,
  replaceOffscreenRgba,
  rowToJson,
  rowsToJson,
  setCanvasWorkTime,
  transparentRgba,
} from './helpers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE_CLIP = join(ROOT, 'sample', 'export_sample.clip');
const TEMPLATE_OUT = join(ROOT, 'public', 'clip-export-template.clip');
const PROTOTYPES_OUT = join(ROOT, 'src', 'web', 'export', 'clip', 'textPrototypes.gen.ts');
const TEMP_CLIP = join(ROOT, 'sample', '_experiments', '_template_build_temp.clip');
const E7_OUT = join(ROOT, 'sample', '_experiments', 'E7_from_template.clip');
const REVIEW_DIR = join(ROOT, 'sample', '_experiments', 'template_review');
const BUILD_REPORT = join(ROOT, 'sample', '_experiments', 'template_build_report.json');

const TEXT_LAYER_IDS = [5, 6, 7] as const;

function ensureDirs(): void {
  mkdirSync(join(ROOT, 'public'), { recursive: true });
  mkdirSync(join(ROOT, 'sample', '_experiments'), { recursive: true });
  mkdirSync(dirname(PROTOTYPES_OUT), { recursive: true });
}

function writeGenTs(templates: Map<number, TextLayerTemplate>): void {
  const entries = TEXT_LAYER_IDS.map((id) => {
    const t = templates.get(id)!;
    return `  ${id}: ${JSON.stringify(
      {
        layer: rowToJson(t.layer),
        blobs: {
          attributes: { __b64: Buffer.from(t.blobs.attributes).toString('base64') },
          addAttributes: { __b64: Buffer.from(t.blobs.addAttributes).toString('base64') },
        },
        mipmapRows: rowsToJson(t.mipmapRows),
        mipmapInfoRows: rowsToJson(t.mipmapInfoRows),
        offscreenRows: rowsToJson(t.offscreenRows),
        thumbnailRows: rowsToJson(t.thumbnailRows),
      },
      null,
      2,
    ).replace(/^/gm, '  ')}`;
  });

  const source = `/**
 * AUTO-GENERATED — do not edit manually.
 * Text layer prototypes (L5/L6/L7) snapshotted from sample/export_sample.clip.
 *
 * Regenerate: npm run clip:template:build
 */
import type { TextLayerTemplate } from './layerOps';

function b64(value: string): Uint8Array {
  // atob works in browsers, workers, and Node >= 16 (Buffer would break worker bundles).
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function jsonToRow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === 'object' && '__b64' in val) {
      out[key] = b64(String((val as { __b64: string }).__b64));
    } else {
      out[key] = val;
    }
  }
  return out;
}

function jsonRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => jsonToRow(row));
}

type RawSnapshot = {
  layer: Record<string, unknown>;
  blobs: { attributes: { __b64: string }; addAttributes: { __b64: string } };
  mipmapRows: Record<string, unknown>[];
  mipmapInfoRows: Record<string, unknown>[];
  offscreenRows: Record<string, unknown>[];
  thumbnailRows: Record<string, unknown>[];
};

const RAW: Record<'5' | '6' | '7', RawSnapshot> = {
${entries.join(',\n')}
};

function hydrate(raw: RawSnapshot): TextLayerTemplate {
  return {
    layer: jsonToRow(raw.layer),
    blobs: {
      attributes: b64(raw.blobs.attributes.__b64),
      addAttributes: b64(raw.blobs.addAttributes.__b64),
    },
    mipmapRows: jsonRows(raw.mipmapRows),
    mipmapInfoRows: jsonRows(raw.mipmapInfoRows),
    offscreenRows: jsonRows(raw.offscreenRows),
    thumbnailRows: jsonRows(raw.thumbnailRows),
  };
}

export const TEXT_LAYER_PROTOTYPES = new Map<number, TextLayerTemplate>([
  [5, hydrate(RAW['5'])],
  [6, hydrate(RAW['6'])],
  [7, hydrate(RAW['7'])],
]);

export function getTextLayerPrototype(mainId: 5 | 6 | 7): TextLayerTemplate {
  const t = TEXT_LAYER_PROTOTYPES.get(mainId);
  if (!t) {
    throw new Error(\`Text layer prototype MainId=\${mainId} missing — run npm run clip:template:build\`);
  }
  return t;
}
`;

  writeFileSync(PROTOTYPES_OUT, source, 'utf8');
}

function vacuumDatabase(db: Database): void {
  db.run('VACUUM');
}

async function buildTemplateClip(): Promise<{
  templates: Map<number, TextLayerTemplate>;
  tempBytes: Uint8Array;
  extas: import('../../src/web/export/clip/container').ClipExta[];
}> {
  const original = new Uint8Array(readFileSync(SAMPLE_CLIP));
  const parsed = parseClip(original);
  const db = await openDatabase(parsed.sqliteBytes);
  let extas = [...parsed.extas];
  const alloc = createIdAllocator(db);

  const templates = new Map<number, TextLayerTemplate>();
  for (const id of TEXT_LAYER_IDS) {
    extas = stripTextLayerFloatCache(db, id, extas);
    templates.set(id, exportTextLayerTemplate(db, id));
  }

  for (const id of [...TEXT_LAYER_IDS].reverse()) {
    const result = deleteTextLayer(db, id, extas, alloc);
    extas = result.extas;
  }

  db.run('UPDATE Layer SET LayerFirstChildIndex = 0, LayerNextIndex = 0 WHERE MainId = ?', [
    TEXT_FOLDER_ID,
  ]);

  extas = removeLayerThumbnailExta(db, PAGE_TEMPLATE_LAYER_ID, extas);
  extas = removeLayerThumbnailExta(db, LINEART_LAYER_ID, extas);

  const pageRgba = decodeOffscreenRgba(
    db,
    PAGE_TEMPLATE_OFFSCREEN_ID,
    extas,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
  );
  paintWhiteRect(pageRgba, CANVAS_WIDTH, pageNumberPixelRect());
  extas = replaceOffscreenRgba(
    db,
    PAGE_TEMPLATE_OFFSCREEN_ID,
    pageRgba,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    extas,
  );

  const lineRgba = transparentRgba(CANVAS_WIDTH, CANVAS_HEIGHT);
  extas = replaceOffscreenRgba(
    db,
    LINEART_OFFSCREEN_ID,
    lineRgba,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    extas,
  );

  setCanvasCurrentLayer(db, LINEART_LAYER_ID);
  setLayerSelect(db, LINEART_LAYER_ID);
  setCanvasWorkTime(db, 0);

  rebuildExternalChunk(db, extas);
  vacuumDatabase(db);
  const sqliteBytes = exportDatabase(db);
  db.close();

  const tempBytes = rebuildClip({ ...parsed, extas }, sqliteBytes);
  writeFileSync(TEMP_CLIP, tempBytes);
  return { templates, tempBytes, extas };
}

function runPythonPreview(): void {
  execSync(`python "${join(ROOT, 'tools', 'clip-template', 'render_preview.py')}" "${TEMP_CLIP}" "${TEMPLATE_OUT}"`, {
    stdio: 'inherit',
    cwd: ROOT,
  });
}

async function runE7Roundtrip(): Promise<Record<string, unknown>> {
  const templateBytes = new Uint8Array(readFileSync(TEMPLATE_OUT));
  const parsed = parseClip(templateBytes);
  const db = await openDatabase(parsed.sqliteBytes);
  let extas = [...parsed.extas];
  const alloc = createIdAllocator(db);

  const { TEXT_LAYER_PROTOTYPES } = await import('../../src/web/export/clip/textPrototypes.gen.ts');

  const clones: {
    content: string;
    anchorRight: number;
    anchorTop: number;
    fontSizePt: number;
  }[] = [
    { content: 'テンプレ検証', anchorRight: 1200, anchorTop: 300, fontSizePt: 8 },
    { content: '二行の\r\nテスト', anchorRight: 700, anchorTop: 800, fontSizePt: 8 },
    { content: '三行\r\nある\r\nはず', anchorRight: 400, anchorTop: 1400, fontSizePt: 8 },
  ];

  const cloneResults: Record<string, unknown>[] = [];
  for (const spec of clones) {
    const prototypeId = textLayerPrototypeMainId(spec.content);
    const template = pickTextLayerTemplate(TEXT_LAYER_PROTOTYPES, spec.content);
    const result = cloneTextLayer(db, prototypeId, TEXT_FOLDER_ID, spec, extas, alloc, {
      template,
      thumbnailWithExta: false,
    });
    extas = result.extas;
    cloneResults.push({
      newMainId: result.newMainId,
      layerName: result.layerName,
      prototypeMainId: prototypeId,
      content: spec.content,
    });
  }

  setCanvasCurrentLayer(db, LINEART_LAYER_ID);
  setLayerSelect(db, LINEART_LAYER_ID);

  rebuildExternalChunk(db, extas);
  vacuumDatabase(db);
  const sqliteBytes = exportDatabase(db);
  db.close();

  const rebuilt = rebuildClip({ ...parsed, extas }, sqliteBytes);
  writeFileSync(E7_OUT, rebuilt);

  return {
    output: E7_OUT,
    clones: cloneResults,
    fileSize: rebuilt.length,
    chunkBreakdown: chunkSizeBreakdown(rebuilt),
  };
}

function runValidations(paths: string[]): Record<string, unknown> {
  const py = (script: string, args: string[]) =>
    execSync(`python "${join(ROOT, 'tools', 'clip-experiments', script)}" ${args.map((a) => `"${a}"`).join(' ')}`, {
      encoding: 'utf8',
      cwd: ROOT,
    });

  const validatePy = py('validate.py', paths);
  const validateIntegrity = py('validate_integrity.py', paths);
  const validateTlv = py('validate_tlv.py', paths);
  const validateClean = execSync(
    `python "${join(ROOT, 'tools', 'clip-template', 'validate_clean.py')}" "${TEMPLATE_OUT}" "${REVIEW_DIR}"`,
    { encoding: 'utf8', cwd: ROOT },
  );

  return {
    validate_py: validatePy,
    validate_integrity: validateIntegrity,
    validate_tlv: validateTlv,
    validate_clean: validateClean,
  };
}

async function main(): Promise<void> {
  ensureDirs();
  console.log('=== clip:template:build ===');
  console.log('Source:', SAMPLE_CLIP);

  const { templates, tempBytes } = await buildTemplateClip();
  console.log('Template SQLite built (temp):', TEMP_CLIP, `(${tempBytes.length} bytes)`);

  writeGenTs(templates);
  console.log('Prototypes written:', PROTOTYPES_OUT);

  runPythonPreview();
  const templateBytes = readFileSync(TEMPLATE_OUT);
  const templateBreakdown = chunkSizeBreakdown(new Uint8Array(templateBytes));
  const prototypesStat = readFileSync(PROTOTYPES_OUT);

  console.log('\n--- Asset summary ---');
  console.log('Template:', TEMPLATE_OUT, `${templateBytes.length} bytes`);
  console.log('Chunk breakdown:', JSON.stringify(templateBreakdown, null, 2));
  console.log('Prototypes:', PROTOTYPES_OUT, `${prototypesStat.length} bytes`);

  const e7 = await runE7Roundtrip();
  console.log('\n--- E7 roundtrip ---');
  console.log(JSON.stringify(e7, null, 2));

  console.log('\n--- Validations ---');
  const validation = runValidations([TEMPLATE_OUT, E7_OUT]);
  console.log(validation.validate_clean);

  const report = {
    generatedAt: new Date().toISOString(),
    template: {
      path: TEMPLATE_OUT,
      size: templateBytes.length,
      chunkBreakdown: templateBreakdown,
    },
    prototypes: {
      path: PROTOTYPES_OUT,
      size: prototypesStat.length,
    },
    e7,
    validation,
  };
  writeFileSync(BUILD_REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nReport:', BUILD_REPORT);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
