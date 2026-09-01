/** §6 marquee minimum — raster px; smaller rects are no-op. */
export const MIN_MARQUEE_RASTER_PX = 4;

/** Clip axis scale floor (free transform). */
export const MIN_CLIP_SCALE = 0.1;

/** World-space hit radius for clip transform handles (CSS px, pre-zoom). */
export const CLIP_HANDLE_RADIUS = 12;

/** Workspace offset applied when duplicating a pasteboard clip. */
export const CLIP_DUPLICATE_OFFSET = 16;

export const CLIP_FRAME_ATTR = 'data-clip-frame';
export const CLIP_ID_ATTR = 'data-clip-id';
export const CLIP_CHROME_ATTR = 'data-clip-chrome';
export const CLIP_DELETE_ATTR = 'data-clip-delete';
export const CLIP_COPY_ATTR = 'data-clip-copy';
export const CLIP_INSERT_ATTR = 'data-clip-insert';
