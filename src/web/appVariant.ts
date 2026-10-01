/** Set by the Pages workflow for non-production repos (e.g. MangaSketcher-test). */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'MangaSketcher';

/** Test deploys use inverted icons so they are easy to tell apart on the home screen. */
export const APP_ICON_DIR = APP_NAME === 'MangaSketcher' ? '/icons' : '/icons/test';
