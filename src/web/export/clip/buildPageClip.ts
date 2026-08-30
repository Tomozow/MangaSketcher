/**
 * Build one CSP .clip file from the cleaned export template plus page content.
 * Environment-agnostic (works in a Web Worker and in Node tests); callers
 * provide an initialized sql.js runtime.
 */
import type { SqlJsStatic } from 'sql.js';
import { convertWrapToExplicitNewlines } from '../../../domain/textWrap';
import type { Rect } from '../../../domain/types';
import { sortPageTexts } from '../sortPageTexts';
import {
  rasterizeCanvasPreviewPng,
  readPageTemplateRgba,
  writeCanvasPreview,
} from './canvasPreview';
import { rebuildExternalChunk, replaceOffscreenRgba } from './clipDb';
import { randomDocumentUuid, rebuildClip, type ParsedClip } from './container';
import {
  CLIP_CANVAS_HEIGHT,
  CLIP_CANVAS_WIDTH,
  CLIP_LINEART_LAYER_ID,
  CLIP_LINEART_OFFSCREEN_ID,
  CLIP_TEXT_FOLDER_ID,
} from './exportConstants';
import {
  cloneTextLayer,
  createIdAllocator,
  pickTextLayerTemplate,
  setCanvasCurrentLayer,
  setLayerSelect,
  type CloneTextLayerParams,
} from './layerOps';
import { TEXT_LAYER_PROTOTYPES } from './textPrototypes.gen';
import {
  BASE_FONT_SIZE_PT,
  FONT_SIZE_SCALE,
  LINE_PITCH_8PT_PX,
  textLayerPrototypeMainId,
  verticalTextMetrics,
} from './textTlv';

export interface ClipPageTextInput {
  content: string;
  /** Page raster coordinates (e.g. 1200x1700). */
  box: Rect;
  /** Font size in page raster px. */
  fontSize: number;
}

/**
 * App raster px → CSP font points.
 * App glyph pitch = fontSize px; CSP verified pitch = 33 px per 8 pt on the
 * 1518px canvas (text_tlv_layout.md §10.1), so matching the pitch keeps the
 * exported glyph size equal to the app rendering.
 */
export function clipFontSizePt(fontSizePx: number, rasterWidth: number): number {
  const fontPx = Math.max(1, Number.isFinite(fontSizePx) ? fontSizePx : 12);
  const cspPx = fontPx * (CLIP_CANVAS_WIDTH / rasterWidth);
  return cspPx * (BASE_FONT_SIZE_PT / LINE_PITCH_8PT_PX);
}

/**
 * Convert a page text to cloneTextLayer params: wrap → explicit CRLF, box
 * top-right → canvas anchor, px → pt. Returns null when the app renders
 * nothing for this text (empty/degenerate), in which case no layer is made.
 */
export function pageTextToClipSpec(
  text: ClipPageTextInput,
  rasterWidth: number,
  rasterHeight: number,
): CloneTextLayerParams | null {
  const content = convertWrapToExplicitNewlines(text.content, text.box, text.fontSize);
  if (content.length === 0) {
    return null;
  }

  const fontSizePt = clipFontSizePt(text.fontSize, rasterWidth);
  let anchorRight = Math.round(
    (text.box.x + text.box.width) * (CLIP_CANVAS_WIDTH / rasterWidth),
  );
  const anchorTop = Math.max(
    0,
    Math.round(text.box.y * (CLIP_CANVAS_HEIGHT / rasterHeight)),
  );

  // The TLV bbox is stored as u32; keep left >= 0 so it cannot wrap around.
  const metrics = verticalTextMetrics(content, Math.round(fontSizePt * FONT_SIZE_SCALE));
  if (anchorRight - metrics.width < 0) {
    anchorRight = metrics.width;
  }

  return { content, anchorRight, anchorTop, fontSizePt };
}

export interface BuildPageClipInput {
  sql: SqlJsStatic;
  /** Parsed public/clip-export-template.clip; not mutated. */
  template: ParsedClip;
  texts: readonly ClipPageTextInput[];
  rasterWidth: number;
  rasterHeight: number;
  /** CLIP_CANVAS_WIDTH x CLIP_CANVAS_HEIGHT RGBA, or null to keep the transparent template line art. */
  lineartRgba?: Uint8Array | null;
  /**
   * Decoded page_template pixels (1518×2150 RGBA). When omitted, decoded from
   * the template once per page. Pass a cached copy from the export job.
   */
  templatePreviewRgba?: Uint8Array;
  /** Skip compositing and write this PNG into CanvasPreview as-is. */
  previewPng?: Uint8Array;
}

export function buildPageClip(input: BuildPageClipInput): Uint8Array {
  const db = new input.sql.Database(input.template.sqliteBytes);
  try {
    let extas = [...input.template.extas];
    const alloc = createIdAllocator(db);

    for (const text of sortPageTexts(input.texts)) {
      const spec = pageTextToClipSpec(text, input.rasterWidth, input.rasterHeight);
      if (!spec) {
        continue;
      }
      const prototypeId = textLayerPrototypeMainId(spec.content);
      const template = pickTextLayerTemplate(TEXT_LAYER_PROTOTYPES, spec.content);
      const result = cloneTextLayer(db, prototypeId, CLIP_TEXT_FOLDER_ID, spec, extas, alloc, {
        template,
        // Cache-less clone: CSP re-renders text on open (verified in E7).
        thumbnailWithExta: false,
      });
      extas = result.extas;
    }

    if (input.lineartRgba) {
      extas = replaceOffscreenRgba(
        db,
        CLIP_LINEART_OFFSCREEN_ID,
        input.lineartRgba,
        CLIP_CANVAS_WIDTH,
        CLIP_CANVAS_HEIGHT,
        extas,
      );
    }

    const previewPng =
      input.previewPng ??
      rasterizeCanvasPreviewPng({
        templateRgba: input.templatePreviewRgba ?? readPageTemplateRgba(db, extas),
        lineartRgba: input.lineartRgba ?? null,
        texts: input.texts,
        rasterWidth: input.rasterWidth,
        rasterHeight: input.rasterHeight,
      });
    writeCanvasPreview(db, previewPng);

    setCanvasCurrentLayer(db, CLIP_LINEART_LAYER_ID);
    setLayerSelect(db, CLIP_LINEART_LAYER_ID);
    rebuildExternalChunk(db, extas);
    // rebuildExternalChunk deletes + reinserts rows; VACUUM keeps freed pages
    // (deleted strings) out of the emitted database.
    db.run('VACUUM');
    const sqliteBytes = db.export();
    // Mint a fresh CHNKHead UUID per file. Reusing the template id makes CSP /
    // Explorer reuse the template's thumbnail cache, so the exported file
    // appears to have no thumbnail (ClipMerger clip_io.py; confirmed against
    // app_export_p001.clip vs usersave2).
    return rebuildClip(
      {
        ...input.template,
        extas,
        head: { ...input.template.head, documentUuid: randomDocumentUuid() },
      },
      sqliteBytes,
    );
  } finally {
    db.close();
  }
}
