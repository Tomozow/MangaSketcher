/**
 * Constants for the production .clip export pipeline.
 * Values mirror tools/clip-template/helpers.ts (browser code must not import tools/)
 * and describe public/clip-export-template.clip.
 */

/** CSP canvas size baked into the export template (600 DPI). */
export const CLIP_CANVAS_WIDTH = 1518;
export const CLIP_CANVAS_HEIGHT = 2150;

/** Layer MainIds baked into the export template. */
export const CLIP_TEXT_FOLDER_ID = 9;
export const CLIP_LINEART_LAYER_ID = 8;
export const CLIP_LINEART_OFFSCREEN_ID = 48;
export const CLIP_PAGE_TEMPLATE_OFFSCREEN_ID = 5;

/** Static assets served from public/. */
export const CLIP_TEMPLATE_URL = '/clip-export-template.clip';
export const CLIP_SQL_WASM_URL = '/sql-wasm-browser.wasm';
