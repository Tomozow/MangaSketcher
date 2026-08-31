import type { Metadata, Viewport } from 'next';
import { DisableContextMenu } from '@/src/web/DisableContextMenu';
import { ServiceWorkerRegistrar } from '@/src/web/ServiceWorkerRegistrar';
import './globals.css';
import '@/src/web/editor.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#F4F1EA',
};

export const metadata: Metadata = {
  title: 'MangaSketcher',
  description: 'iPad manga name editor',
  applicationName: 'MangaSketcher',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MangaSketcher',
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
  icons: {
    apple: [
      { url: '/icons/icon-180.png', sizes: '180x180' },
      { url: '/icons/icon-192.png', sizes: '192x192' },
    ],
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192' },
      { url: '/icons/icon-512.png', sizes: '512x512' },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <DisableContextMenu />
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
