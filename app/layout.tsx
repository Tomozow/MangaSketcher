import type { Metadata, Viewport } from 'next';
import { DebugErrorProbe } from '@/src/web/DebugErrorProbe';
import { DisableContextMenu } from '@/src/web/DisableContextMenu';
import { ServiceWorkerRegistrar } from '@/src/web/ServiceWorkerRegistrar';
import { StandaloneHtmlFlag } from '@/src/web/StandaloneHtmlFlag';
import { MARK_STANDALONE_SCRIPT } from '@/src/web/displayMode';
import { publicUrl } from '@/src/web/publicUrl';
import { APP_ICON_DIR, APP_NAME } from '@/src/web/appVariant';
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
  title: APP_NAME,
  description: 'iPad manga name editor',
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_NAME,
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
  icons: {
    apple: [
      { url: publicUrl(`${APP_ICON_DIR}/icon-180.png`), sizes: '180x180' },
      { url: publicUrl(`${APP_ICON_DIR}/icon-192.png`), sizes: '192x192' },
    ],
    icon: [
      { url: publicUrl(`${APP_ICON_DIR}/icon-192.png`), sizes: '192x192' },
      { url: publicUrl(`${APP_ICON_DIR}/icon-512.png`), sizes: '512x512' },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MARK_STANDALONE_SCRIPT }} />
      </head>
      <body>
        <StandaloneHtmlFlag />
        <DebugErrorProbe />
        <DisableContextMenu />
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
