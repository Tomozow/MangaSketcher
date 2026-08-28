import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegistrar } from '@/src/web/ServiceWorkerRegistrar';
import './globals.css';

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
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
