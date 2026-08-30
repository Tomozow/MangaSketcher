import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MangaSketcher',
    short_name: 'MangaSketcher',
    display: 'standalone',
    orientation: 'any',
    start_url: '/',
    background_color: '#F4F1EA',
    theme_color: '#F4F1EA',
    icons: [
      {
        src: '/icons/icon-180.png',
        sizes: '180x180',
        type: 'image/png',
      },
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
