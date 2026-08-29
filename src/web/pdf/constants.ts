export { LONG_PRESS_MS, PAN_SLOP } from '../../domain/workspaceGestures';

/** Minimum range rectangle edge in CSS px (§8.6 / §10.3). */
export const MIN_RANGE_CSS = 8;

/** pdf.js render: long edge clamp for the immediate fallback bitmap. */
export const PDF_MAX_EDGE = 2048;
/** Sharper pass: long-edge hint; iOS area cap in renderScaleForPage is the real limit. */
export const PDF_SHARP_MAX_EDGE = 8192;

export const PDF_WORKER_SRC = '/pdf.worker.min.mjs';
