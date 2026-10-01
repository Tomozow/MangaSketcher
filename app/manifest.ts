import type { MetadataRoute } from 'next';
import { publicUrl } from '@/src/web/publicUrl';
import { APP_ICON_DIR, APP_NAME } from '@/src/web/appVariant';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    display: 'standalone',
    start_url: publicUrl('/'),
    scope: publicUrl('/'),
    background_color: '#F4F1EA',
    theme_color: '#F4F1EA',
    icons: [
      {
        src: publicUrl(`${APP_ICON_DIR}/icon-180.png`),
        sizes: '180x180',
        type: 'image/png',
      },
      {
        src: publicUrl(`${APP_ICON_DIR}/icon-192.png`),
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: publicUrl(`${APP_ICON_DIR}/icon-512.png`),
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
